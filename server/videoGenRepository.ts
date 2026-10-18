import { getStudioPool } from "./studioRepository";
import type {
  ShotPlan,
  ShotPlanInput,
  ShotPlanStatus,
  VideoGenAdapter,
  VideoGenJob,
  VideoGenJobStatus,
  VideoGenMode,
} from "./videoGenTypes";

function mapShotPlan(row: any): ShotPlan {
  return {
    id: Number(row.id),
    scriptId: Number(row.script_id),
    sceneNumber: Number(row.scene_number),
    durationSeconds: Number(row.duration_seconds),
    description: row.description,
    promptText: row.prompt_text,
    cameraNotes: row.camera_notes ?? null,
    audioNotes: row.audio_notes ?? null,
    referenceAssetId: row.reference_asset_id != null ? Number(row.reference_asset_id) : null,
    status: row.status as ShotPlanStatus,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function mapJob(row: any): VideoGenJob {
  return {
    id: Number(row.id),
    shotPlanId: Number(row.shot_plan_id),
    videoId: row.video_id != null ? Number(row.video_id) : null,
    provider: row.provider,
    mode: row.mode as VideoGenMode,
    prompt: row.prompt,
    negativePrompt: row.negative_prompt ?? null,
    referenceAssetId: row.reference_asset_id != null ? Number(row.reference_asset_id) : null,
    status: row.status as VideoGenJobStatus,
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    providerJobId: row.provider_job_id ?? null,
    outputAssetId: row.output_asset_id != null ? Number(row.output_asset_id) : null,
    estimatedCost: Number(row.estimated_cost),
    actualCost: Number(row.actual_cost),
    error: row.error ?? null,
    startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
    finishedAt: row.finished_at ? new Date(row.finished_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export async function listShotPlansByScript(scriptId: number): Promise<ShotPlan[]> {
  const pool = getStudioPool();
  if (!pool) throw new Error("Neon não configurado.");
  const result = await pool.query(
    `SELECT * FROM shot_plans WHERE script_id = $1 ORDER BY scene_number ASC`,
    [scriptId],
  );
  return result.rows.map(mapShotPlan);
}

export async function replaceShotPlansForScript(
  scriptId: number,
  scenes: ShotPlanInput[],
): Promise<ShotPlan[]> {
  const pool = getStudioPool();
  if (!pool) throw new Error("Neon não configurado.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `DELETE FROM shot_plans WHERE script_id = $1 AND status = 'planned'`,
      [scriptId],
    );
    const inserted: ShotPlan[] = [];
    for (const scene of scenes) {
      const result = await client.query(
        `INSERT INTO shot_plans
          (script_id, scene_number, duration_seconds, description, prompt_text, camera_notes, audio_notes, reference_asset_id, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'planned')
         ON CONFLICT (script_id, scene_number) DO UPDATE SET
           duration_seconds = EXCLUDED.duration_seconds,
           description = EXCLUDED.description,
           prompt_text = EXCLUDED.prompt_text,
           camera_notes = EXCLUDED.camera_notes,
           audio_notes = EXCLUDED.audio_notes,
           reference_asset_id = EXCLUDED.reference_asset_id,
           status = 'planned'
         RETURNING *`,
        [
          scriptId,
          scene.sceneNumber,
          scene.durationSeconds,
          scene.description,
          scene.promptText,
          scene.cameraNotes ?? null,
          scene.audioNotes ?? null,
          scene.referenceAssetId ?? null,
        ],
      );
      inserted.push(mapShotPlan(result.rows[0]));
    }
    await client.query("COMMIT");
    return inserted;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateShotPlanStatus(
  id: number,
  status: ShotPlanStatus,
): Promise<ShotPlan | null> {
  const pool = getStudioPool();
  if (!pool) throw new Error("Neon não configurado.");
  const result = await pool.query(
    `UPDATE shot_plans SET status = $2 WHERE id = $1 RETURNING *`,
    [id, status],
  );
  return result.rows[0] ? mapShotPlan(result.rows[0]) : null;
}

export async function updateShotPlan(
  id: number,
  patch: { promptText?: string; durationSeconds?: number; description?: string },
): Promise<ShotPlan | null> {
  const pool = getStudioPool();
  if (!pool) throw new Error("Neon não configurado.");
  const result = await pool.query(
    `UPDATE shot_plans
     SET prompt_text = COALESCE($2, prompt_text),
         duration_seconds = COALESCE($3, duration_seconds),
         description = COALESCE($4, description)
     WHERE id = $1 AND status IN ('planned', 'approved')
     RETURNING *`,
    [
      id,
      patch.promptText ?? null,
      patch.durationSeconds ?? null,
      patch.description ?? null,
    ],
  );
  return result.rows[0] ? mapShotPlan(result.rows[0]) : null;
}

export async function listActiveVideoGenAdapters(): Promise<VideoGenAdapter[]> {
  const pool = getStudioPool();
  if (!pool) throw new Error("Neon não configurado.");
  const result = await pool.query(
    `SELECT id, capability, provider, plan, active, priority, config
     FROM adapters
     WHERE capability = 'video_gen' AND active = TRUE
     ORDER BY priority ASC`,
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    capability: row.capability,
    provider: row.provider,
    plan: row.plan,
    active: Boolean(row.active),
    priority: Number(row.priority),
    config: (row.config ?? {}) as Record<string, unknown>,
  }));
}

export async function listAllVideoGenAdapters(): Promise<VideoGenAdapter[]> {
  const pool = getStudioPool();
  if (!pool) throw new Error("Neon não configurado.");
  const result = await pool.query(
    `SELECT id, capability, provider, plan, active, priority, config
     FROM adapters
     WHERE capability = 'video_gen'
     ORDER BY priority ASC`,
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    capability: row.capability,
    provider: row.provider,
    plan: row.plan,
    active: Boolean(row.active),
    priority: Number(row.priority),
    config: (row.config ?? {}) as Record<string, unknown>,
  }));
}

export async function createVideoGenJobs(
  jobs: Array<{
    shotPlanId: number;
    videoId?: number | null;
    provider: string;
    mode: VideoGenMode;
    prompt: string;
    negativePrompt?: string | null;
    referenceAssetId?: number | null;
    estimatedCost?: number;
  }>,
): Promise<VideoGenJob[]> {
  const pool = getStudioPool();
  if (!pool) throw new Error("Neon não configurado.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const created: VideoGenJob[] = [];
    for (const job of jobs) {
      const existing = await client.query(
        `SELECT id FROM video_gen_jobs
         WHERE shot_plan_id = $1 AND status IN ('queued', 'running')
         LIMIT 1`,
        [job.shotPlanId],
      );
      if (existing.rowCount && existing.rowCount > 0) continue;

      const result = await client.query(
        `INSERT INTO video_gen_jobs
          (shot_plan_id, video_id, provider, mode, prompt, negative_prompt, reference_asset_id, estimated_cost, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'queued')
         RETURNING *`,
        [
          job.shotPlanId,
          job.videoId ?? null,
          job.provider,
          job.mode,
          job.prompt,
          job.negativePrompt ?? null,
          job.referenceAssetId ?? null,
          job.estimatedCost ?? 0,
        ],
      );
      created.push(mapJob(result.rows[0]));
    }
    await client.query("COMMIT");
    return created;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listVideoGenJobsByScript(scriptId: number): Promise<VideoGenJob[]> {
  const pool = getStudioPool();
  if (!pool) throw new Error("Neon não configurado.");
  const result = await pool.query(
    `SELECT j.*
     FROM video_gen_jobs j
     JOIN shot_plans s ON s.id = j.shot_plan_id
     WHERE s.script_id = $1
     ORDER BY s.scene_number ASC, j.created_at ASC`,
    [scriptId],
  );
  return result.rows.map(mapJob);
}

export async function listQueuedVideoGenJobs(limit = 10): Promise<VideoGenJob[]> {
  const pool = getStudioPool();
  if (!pool) throw new Error("Neon não configurado.");
  const result = await pool.query(
    `SELECT * FROM video_gen_jobs
     WHERE status = 'queued' AND attempts < max_attempts
     ORDER BY created_at ASC
     LIMIT $1
     FOR UPDATE SKIP LOCKED`,
    [limit],
  );
  return result.rows.map(mapJob);
}

export async function claimQueuedVideoGenJobs(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> },
  limit = 5,
): Promise<VideoGenJob[]> {
  const result = await client.query(
    `SELECT * FROM video_gen_jobs
     WHERE status = 'queued' AND attempts < max_attempts
     ORDER BY created_at ASC
     LIMIT $1
     FOR UPDATE SKIP LOCKED`,
    [limit],
  );
  return result.rows.map(mapJob);
}

export async function listRunningVideoGenJobs(limit = 20): Promise<VideoGenJob[]> {
  const pool = getStudioPool();
  if (!pool) throw new Error("Neon não configurado.");
  const result = await pool.query(
    `SELECT * FROM video_gen_jobs
     WHERE status = 'running' AND provider_job_id IS NOT NULL
     ORDER BY started_at ASC NULLS FIRST
     LIMIT $1`,
    [limit],
  );
  return result.rows.map(mapJob);
}

export async function markVideoGenJobRunning(
  id: number,
  providerJobId?: string | null,
): Promise<VideoGenJob | null> {
  const pool = getStudioPool();
  if (!pool) throw new Error("Neon não configurado.");
  const result = await pool.query(
    `UPDATE video_gen_jobs
     SET status = 'running',
         attempts = attempts + 1,
         started_at = COALESCE(started_at, NOW()),
         provider_job_id = COALESCE($2, provider_job_id),
         error = NULL
     WHERE id = $1 AND status IN ('queued', 'failed') AND attempts < max_attempts
     RETURNING *`,
    [id, providerJobId ?? null],
  );
  return result.rows[0] ? mapJob(result.rows[0]) : null;
}

export async function completeVideoGenJob(
  id: number,
  data: { outputAssetId?: number | null; actualCost?: number; providerJobId?: string | null },
): Promise<VideoGenJob | null> {
  const pool = getStudioPool();
  if (!pool) throw new Error("Neon não configurado.");
  const result = await pool.query(
    `UPDATE video_gen_jobs
     SET status = 'succeeded',
         output_asset_id = COALESCE($2, output_asset_id),
         actual_cost = COALESCE($3, actual_cost),
         provider_job_id = COALESCE($4, provider_job_id),
         finished_at = NOW(),
         error = NULL
     WHERE id = $1
     RETURNING *`,
    [id, data.outputAssetId ?? null, data.actualCost ?? 0, data.providerJobId ?? null],
  );
  return result.rows[0] ? mapJob(result.rows[0]) : null;
}

export async function failVideoGenJob(id: number, error: string): Promise<VideoGenJob | null> {
  const pool = getStudioPool();
  if (!pool) throw new Error("Neon não configurado.");
  const result = await pool.query(
    `UPDATE video_gen_jobs
     SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
         error = $2,
         finished_at = CASE WHEN attempts >= max_attempts THEN NOW() ELSE NULL END
     WHERE id = $1
     RETURNING *`,
    [id, error.slice(0, 2000)],
  );
  return result.rows[0] ? mapJob(result.rows[0]) : null;
}

export async function insertClipAsset(params: {
  scriptId: number | null;
  videoId: number | null;
  uri: string;
  cost: number;
  source: string;
}): Promise<number> {
  const pool = getStudioPool();
  if (!pool) throw new Error("Neon não configurado.");
  const result = await pool.query(
    `INSERT INTO assets (script_id, video_id, type, uri, license, source, cost)
     VALUES ($1, $2, 'clip', $3, 'generated', $4, $5)
     RETURNING id`,
    [params.scriptId, params.videoId, params.uri, params.source, params.cost],
  );
  return Number(result.rows[0].id);
}

export async function recordQuotaUsage(api: string, units: number) {
  const pool = getStudioPool();
  if (!pool) return;
  try {
    await pool.query(`INSERT INTO quota_log (api, units) VALUES ($1, $2)`, [api, units]);
  } catch {
    // quota é best-effort
  }
}
