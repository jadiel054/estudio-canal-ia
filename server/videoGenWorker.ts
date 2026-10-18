import { createHmac, timingSafeEqual } from "node:crypto";
import { getStudioPool, appendStudioAudit } from "./studioRepository";
import {
  claimQueuedVideoGenJobs,
  completeVideoGenJob,
  failVideoGenJob,
  insertClipAsset,
  listRunningVideoGenJobs,
  recordQuotaUsage,
  updateShotPlanStatus,
} from "./videoGenRepository";
import { resolveProvider } from "./videoGenProviders";

const RUNNING_TIMEOUT_MS = 30 * 60_000;

function requiredCronSecret() {
  const value = process.env.STUDIO_RENDER_HMAC_SECRET;
  if (!value || value.length < 32) {
    throw new Error("STUDIO_RENDER_HMAC_SECRET ausente ou curto demais para proteger o worker de video_gen.");
  }
  return value;
}

export function verifyCronSignature(params: {
  path: string;
  timestamp: string;
  signature: string;
  body?: string;
}): boolean {
  try {
    const secret = requiredCronSecret();
    const ts = Number(params.timestamp);
    if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 5 * 60_000) return false;
    const payload = `${params.path}\n${params.timestamp}\n${params.body ?? ""}`;
    const expected = createHmac("sha256", secret).update(payload).digest("hex");
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(params.signature, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function processVideoGenQueue(limit = 5) {
  const pool = getStudioPool();
  if (!pool) throw new Error("Neon não configurado.");

  const client = await pool.connect();
  const submitted: Array<{ jobId: number; providerJobId: string; provider: string }> = [];
  const failures: Array<{ jobId: number; error: string }> = [];

  try {
    await client.query("BEGIN");
    const jobs = await claimQueuedVideoGenJobs(client, limit);

    for (const job of jobs) {
      try {
        const provider = resolveProvider(job.provider);
        const submit = await provider.submit({
          prompt: job.prompt,
          negativePrompt: job.negativePrompt,
          mode: job.mode,
        });
        await client.query(
          `UPDATE video_gen_jobs
           SET status = 'running',
               attempts = attempts + 1,
               started_at = COALESCE(started_at, NOW()),
               provider_job_id = $2,
               error = NULL
           WHERE id = $1`,
          [job.id, submit.providerJobId],
        );
        submitted.push({ jobId: job.id, providerJobId: submit.providerJobId, provider: job.provider });
      } catch (error) {
        const message = error instanceof Error ? error.message : "submit falhou";
        await client.query(
          `UPDATE video_gen_jobs
           SET attempts = attempts + 1,
               error = $2,
               status = CASE WHEN attempts + 1 >= max_attempts THEN 'failed' ELSE 'queued' END,
               finished_at = CASE WHEN attempts + 1 >= max_attempts THEN NOW() ELSE NULL END
           WHERE id = $1`,
          [job.id, message.slice(0, 2000)],
        );
        failures.push({ jobId: job.id, error: message });
      }
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  if (submitted.length || failures.length) {
    await appendStudioAudit({
      actor: "Sistema",
      action: "video_gen processQueue",
      target: "video_gen_jobs",
      details: { submitted: submitted.length, failures: failures.length },
    });
  }

  return { submitted, failures };
}

export async function pollRunningVideoGenJobs(limit = 20) {
  const running = await listRunningVideoGenJobs(limit);
  const completed: number[] = [];
  const failed: number[] = [];
  const timedOut: number[] = [];
  const stillRunning: number[] = [];

  for (const job of running) {
    // Timeout: running há mais de 30 min → failed (libera a unique parcial)
    const startedMs = job.startedAt ? Date.parse(job.startedAt) : NaN;
    if (Number.isFinite(startedMs) && Date.now() - startedMs > RUNNING_TIMEOUT_MS) {
      await failVideoGenJob(job.id, "timeout");
      await updateShotPlanStatus(job.shotPlanId, "failed");
      timedOut.push(job.id);
      failed.push(job.id);
      continue;
    }

    if (!job.providerJobId) continue;
    try {
      const provider = resolveProvider(job.provider);
      const poll = await provider.poll(job.providerJobId);

      if (poll.status === "running") {
        stillRunning.push(job.id);
        continue;
      }

      if (poll.status === "failed") {
        await failVideoGenJob(job.id, poll.error);
        await updateShotPlanStatus(job.shotPlanId, "failed");
        failed.push(job.id);
        continue;
      }

      const downloaded = await provider.download(poll.downloadUrl);
      const assetId = await insertClipAsset({
        scriptId: null,
        videoId: job.videoId,
        uri: downloaded.uri,
        cost: poll.actualCost,
        source: job.provider,
      });
      await completeVideoGenJob(job.id, {
        outputAssetId: assetId,
        actualCost: poll.actualCost,
        providerJobId: job.providerJobId,
      });
      await updateShotPlanStatus(job.shotPlanId, "done");
      await recordQuotaUsage(`video_gen:${job.provider}`, 1);
      completed.push(job.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "poll falhou";
      await failVideoGenJob(job.id, message);
      failed.push(job.id);
    }
  }

  if (completed.length || failed.length) {
    await appendStudioAudit({
      actor: "Sistema",
      action: "video_gen pollRunning",
      target: "video_gen_jobs",
      details: {
        completed: completed.length,
        failed: failed.length,
        timedOut: timedOut.length,
        stillRunning: stillRunning.length,
      },
    });
  }

  return { completed, failed, timedOut, stillRunning };
}
