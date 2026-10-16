import { randomUUID } from "node:crypto";
import { getStudioPool } from "./studioRepository";
import {
  IMAGE_GENERATION_POLICY,
  type ImageGenerationPolicy,
} from "./imagePolicy";
import { validateImagePayload, type ValidatedImage } from "./imageValidation";

type QueryResult<T> = { rows: T[]; rowCount?: number | null };
type Queryable = {
  query<T = Record<string, unknown>>(
    sql: string,
    values?: unknown[]
  ): Promise<QueryResult<T>>;
};
type DatabaseClient = Queryable & { release(): void };
type DatabasePool = Queryable & { connect(): Promise<DatabaseClient> };

export type ImageRequestMetadata = {
  cacheKey: string;
  promptHash: string;
  policyVersion: string;
  provider: string;
  model: string;
  modelRevision: string;
  preset: string;
  presetVersion: string;
  width: number;
  height: number;
  videoId: string;
  jobId?: string;
  sectionIndex: number;
};

export type ImageUsageEventType =
  | "cache_hit"
  | "cache_miss"
  | "generation"
  | "blocked"
  | "singleflight_wait"
  | "fallback";
export type ImageUsageStatus =
  | "observed"
  | "reserved"
  | "success"
  | "failure"
  | "blocked"
  | "expired"
  | "in_flight";
export type ImageFailureCode =
  | "feature_disabled"
  | "policy_disabled"
  | "license_unconfirmed"
  | "terms_unconfirmed"
  | "model_revision_unpinned"
  | "cost_unknown"
  | "adapter_inactive"
  | "provider_unconfigured"
  | "video_quota"
  | "attempt_quota"
  | "budget_exceeded"
  | "invalid_mime"
  | "mime_mismatch"
  | "invalid_image_bytes"
  | "invalid_dimensions"
  | "dimension_mismatch"
  | "size_exceeded"
  | "unsupported_mime"
  | "provider_failure"
  | "storage_unavailable"
  | "cache_corrupt"
  | "invalid_request"
  | "reservation_expired";

export type ImageCacheLookup =
  | { kind: "hit"; image: ValidatedImage }
  | { kind: "miss" };
export type ImageReservation =
  | { kind: "reserved"; id: string }
  | { kind: "cache_hit"; image: ValidatedImage }
  | { kind: "in_flight" }
  | { kind: "blocked"; code: ImageFailureCode };

export class ImageStoreUnavailableError extends Error {
  constructor() {
    super("Persistência visual indisponível.");
    this.name = "ImageStoreUnavailableError";
  }
}

export class ImageCacheIntegrityError extends Error {
  constructor() {
    super("A imagem não passou pela validação local.");
    this.name = "ImageCacheIntegrityError";
  }
}

function asPool(
  value: ReturnType<typeof getStudioPool>
): DatabasePool | undefined {
  return value as unknown as DatabasePool | undefined;
}

async function insertUsage(
  client: Queryable,
  metadata: ImageRequestMetadata,
  event: {
    eventType: ImageUsageEventType;
    status: ImageUsageStatus;
    failureCode?: ImageFailureCode;
    httpStatus?: number;
    estimatedCostUsd?: number;
    actualCostUsd?: number;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO studio_image_usage (
       id, event_type, status, cache_key, prompt_hash, policy_version, provider, model,
       model_revision, preset, preset_version, width, height, job_id, video_id,
       section_index, failure_code, http_status, estimated_cost_usd, actual_cost_usd,
       reservation_expires_at
     ) VALUES (
       $1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
       $16, $17, $18, $19, $20,
       CASE WHEN $3 = 'reserved' THEN NOW() + INTERVAL '5 minutes' ELSE NULL END
     )`,
    [
      randomUUID(),
      event.eventType,
      event.status,
      metadata.cacheKey,
      metadata.promptHash,
      metadata.policyVersion,
      metadata.provider,
      metadata.model,
      metadata.modelRevision,
      metadata.preset,
      metadata.presetVersion,
      metadata.width,
      metadata.height,
      metadata.jobId ?? null,
      metadata.videoId,
      metadata.sectionIndex,
      event.failureCode ?? null,
      event.httpStatus ?? null,
      event.estimatedCostUsd ?? null,
      event.actualCostUsd ?? null,
    ]
  );
}

function validHttpStatus(status: number | undefined): number | null {
  return status !== undefined &&
    Number.isInteger(status) &&
    status >= 100 &&
    status <= 599
    ? status
    : null;
}

function validCost(value: number | null | undefined): number | null {
  return value !== undefined &&
    value !== null &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= 1_000_000
    ? value
    : null;
}

export class PostgresImageStore {
  constructor(
    private readonly poolProvider: () => DatabasePool | undefined = () =>
      asPool(getStudioPool())
  ) {}

  private pool(): DatabasePool {
    const pool = this.poolProvider();
    if (!pool) throw new ImageStoreUnavailableError();
    return pool;
  }

  private async rollback(client: DatabaseClient): Promise<void> {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* erro original não contém payload nem segredo */
    }
  }

  private async readValidCache(
    client: Queryable,
    metadata: ImageRequestMetadata
  ): Promise<ValidatedImage | "corrupt" | undefined> {
    const result = await client.query<{
      image_bytes: Uint8Array;
      mime_type: string;
      width: number;
      height: number;
      content_sha256: string;
    }>(
      `SELECT image_bytes, mime_type, width, height, content_sha256
         FROM studio_image_cache
        WHERE cache_key = $1 AND policy_version = $2 AND provider = $3 AND model = $4
          AND model_revision = $5 AND preset = $6 AND preset_version = $7
          AND width = $8 AND height = $9 AND expires_at > NOW()
        LIMIT 1`,
      [
        metadata.cacheKey,
        metadata.policyVersion,
        metadata.provider,
        metadata.model,
        metadata.modelRevision,
        metadata.preset,
        metadata.presetVersion,
        metadata.width,
        metadata.height,
      ]
    );
    const row = result.rows[0];
    if (!row) return undefined;
    const checked = validateImagePayload({
      bytes: Buffer.from(row.image_bytes),
      declaredMimeType: row.mime_type,
      expectedWidth: metadata.width,
      expectedHeight: metadata.height,
      maxBytes: IMAGE_GENERATION_POLICY.maxImageBytes,
    });
    if (
      !checked.ok ||
      checked.image.sha256 !== row.content_sha256.trim() ||
      Number(row.width) !== metadata.width ||
      Number(row.height) !== metadata.height
    )
      return "corrupt";
    return checked.image;
  }

  private async recordHit(
    client: Queryable,
    metadata: ImageRequestMetadata,
    image: ValidatedImage
  ): Promise<void> {
    await client.query(
      "UPDATE studio_image_cache SET hit_count = hit_count + 1, last_accessed_at = NOW() WHERE cache_key = $1",
      [metadata.cacheKey]
    );
    await insertUsage(client, metadata, {
      eventType: "cache_hit",
      status: "success",
    });
  }

  async lookupAndAudit(
    metadata: ImageRequestMetadata
  ): Promise<ImageCacheLookup> {
    const client = await this.pool().connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "DELETE FROM studio_image_cache WHERE cache_key = $1 AND expires_at <= NOW()",
        [metadata.cacheKey]
      );
      const cached = await this.readValidCache(client, metadata);
      if (cached && cached !== "corrupt") {
        await this.recordHit(client, metadata, cached);
        await client.query("COMMIT");
        return { kind: "hit", image: cached };
      }
      if (cached === "corrupt") {
        await client.query(
          "UPDATE studio_image_cache SET expires_at = NOW() WHERE cache_key = $1",
          [metadata.cacheKey]
        );
      }
      await insertUsage(client, metadata, {
        eventType: "cache_miss",
        status: "observed",
        ...(cached === "corrupt"
          ? { failureCode: "cache_corrupt" as const }
          : {}),
      });
      await client.query("COMMIT");
      return { kind: "miss" };
    } catch {
      await this.rollback(client);
      throw new ImageStoreUnavailableError();
    } finally {
      client.release();
    }
  }

  async recordEvent(
    metadata: ImageRequestMetadata,
    eventType: ImageUsageEventType,
    status: ImageUsageStatus,
    failureCode?: ImageFailureCode
  ): Promise<void> {
    try {
      await insertUsage(this.pool(), metadata, {
        eventType,
        status,
        failureCode,
      });
    } catch (error) {
      if (error instanceof ImageStoreUnavailableError) throw error;
      throw new ImageStoreUnavailableError();
    }
  }

  async isAdapterActive(policy: ImageGenerationPolicy): Promise<boolean> {
    const result = await this.pool().query<{ active: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM adapters
          WHERE capability = 'image_generation' AND provider = $1 AND active = TRUE
            AND config->>'policy_version' = $2 AND config->>'model' = $3
            AND config->>'model_revision' = $4
       ) AS active`,
      [
        policy.provider,
        policy.policyVersion,
        policy.model,
        policy.modelRevision,
      ]
    );
    return Boolean(result.rows[0]?.active);
  }

  async reserve(
    metadata: ImageRequestMetadata,
    policy: ImageGenerationPolicy,
    estimatedCostUsd: number | null
  ): Promise<ImageReservation> {
    const client = await this.pool().connect();
    try {
      await client.query("BEGIN");
      // Um lock transacional por vídeo serializa os limites de quota e orçamento.
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`studio:image:${metadata.videoId}`]
      );
      await client.query(
        `UPDATE studio_image_usage SET status = 'expired', failure_code = 'reservation_expired',
                reservation_expires_at = NULL, completed_at = NOW()
          WHERE cache_key = $1 AND event_type = 'generation' AND status = 'reserved'
            AND reservation_expires_at <= NOW()`,
        [metadata.cacheKey]
      );

      const cached = await this.readValidCache(client, metadata);
      if (cached && cached !== "corrupt") {
        await this.recordHit(client, metadata, cached);
        await client.query("COMMIT");
        return { kind: "cache_hit", image: cached };
      }
      if (cached === "corrupt") {
        await client.query(
          "UPDATE studio_image_cache SET expires_at = NOW() WHERE cache_key = $1",
          [metadata.cacheKey]
        );
      }

      const active = await client.query<{ active: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM studio_image_usage
            WHERE cache_key = $1 AND event_type = 'generation' AND status = 'reserved'
              AND reservation_expires_at > NOW()
         ) AS active`,
        [metadata.cacheKey]
      );
      if (active.rows[0]?.active) {
        await insertUsage(client, metadata, {
          eventType: "singleflight_wait",
          status: "in_flight",
        });
        await client.query("COMMIT");
        return { kind: "in_flight" };
      }

      const counts = await client.query<{
        attempts: string;
        key_attempts: string;
        spent_usd: string;
      }>(
        `SELECT
           count(*) FILTER (WHERE event_type = 'generation')::text AS attempts,
           count(*) FILTER (WHERE event_type = 'generation' AND cache_key = $2)::text AS key_attempts,
           COALESCE(sum(COALESCE(actual_cost_usd, estimated_cost_usd, 0))
             FILTER (WHERE event_type = 'generation'), 0)::text AS spent_usd
         FROM studio_image_usage WHERE video_id = $1`,
        [metadata.videoId, metadata.cacheKey]
      );
      const totals = counts.rows[0] ?? {
        attempts: "0",
        key_attempts: "0",
        spent_usd: "0",
      };
      const attempts = Number(totals.attempts) || 0;
      const keyAttempts = Number(totals.key_attempts) || 0;
      const spent = Number(totals.spent_usd) || 0;
      let block: ImageFailureCode | undefined;

      if (
        policy.maxImagesPerVideo > policy.hardMaxImagesPerVideo ||
        policy.hardMaxImagesPerVideo > 12
      ) {
        block = "policy_disabled";
      } else if (
        estimatedCostUsd === null ||
        validCost(estimatedCostUsd) === null
      ) {
        block = "cost_unknown";
      } else if (
        attempts >= policy.maxImagesPerVideo ||
        attempts >= policy.hardMaxImagesPerVideo
      ) {
        block = "video_quota";
      } else if (keyAttempts >= policy.maxAttemptsPerCacheKey) {
        block = "attempt_quota";
      } else if (
        policy.maxBudgetUsdPerVideo <= 0 ||
        spent + estimatedCostUsd > policy.maxBudgetUsdPerVideo + 1e-9
      ) {
        block = "budget_exceeded";
      }

      if (block) {
        const safeEstimatedCostUsd = validCost(estimatedCostUsd);
        await insertUsage(client, metadata, {
          eventType: "blocked",
          status: "blocked",
          failureCode: block,
          ...(safeEstimatedCostUsd !== null
            ? { estimatedCostUsd: safeEstimatedCostUsd }
            : {}),
        });
        await client.query("COMMIT");
        return { kind: "blocked", code: block };
      }

      const reservation = await client.query<{ id: string }>(
        `INSERT INTO studio_image_usage (
           id, event_type, status, cache_key, prompt_hash, policy_version, provider, model,
           model_revision, preset, preset_version, width, height, job_id, video_id,
           section_index, estimated_cost_usd, reservation_expires_at
         ) VALUES (
           $1::uuid, 'generation', 'reserved', $2, $3, $4, $5, $6, $7, $8, $9,
           $10, $11, $12, $13, $14, $15, NOW() + INTERVAL '5 minutes'
         ) ON CONFLICT DO NOTHING
         RETURNING id`,
        [
          randomUUID(),
          metadata.cacheKey,
          metadata.promptHash,
          metadata.policyVersion,
          metadata.provider,
          metadata.model,
          metadata.modelRevision,
          metadata.preset,
          metadata.presetVersion,
          metadata.width,
          metadata.height,
          metadata.jobId ?? null,
          metadata.videoId,
          metadata.sectionIndex,
          estimatedCostUsd,
        ]
      );
      const id = reservation.rows[0]?.id;
      if (!id) {
        await insertUsage(client, metadata, {
          eventType: "singleflight_wait",
          status: "in_flight",
        });
        await client.query("COMMIT");
        return { kind: "in_flight" };
      }
      await client.query("COMMIT");
      return { kind: "reserved", id };
    } catch {
      await this.rollback(client);
      throw new ImageStoreUnavailableError();
    } finally {
      client.release();
    }
  }

  async complete(
    metadata: ImageRequestMetadata,
    reservationId: string,
    image: ValidatedImage,
    options: { actualCostUsd?: number; cacheTtlDays: number }
  ): Promise<void> {
    const checked = validateImagePayload({
      bytes: image.bytes,
      declaredMimeType: image.mimeType,
      expectedWidth: metadata.width,
      expectedHeight: metadata.height,
      maxBytes: IMAGE_GENERATION_POLICY.maxImageBytes,
    });
    if (!checked.ok || checked.image.sha256 !== image.sha256)
      throw new ImageCacheIntegrityError();
    const actualCost = validCost(options.actualCostUsd);
    const ttlDays =
      Number.isInteger(options.cacheTtlDays) &&
      options.cacheTtlDays >= 1 &&
      options.cacheTtlDays <= 30
        ? options.cacheTtlDays
        : 7;
    const client = await this.pool().connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO studio_image_cache (
           cache_key, prompt_hash, policy_version, provider, model, model_revision,
           preset, preset_version, width, height, mime_type, image_bytes, content_sha256,
           expires_at, hit_count, last_accessed_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
           NOW() + ($14::int * INTERVAL '1 day'), 0, NULL
         ) ON CONFLICT (cache_key) DO UPDATE SET
           prompt_hash = EXCLUDED.prompt_hash, policy_version = EXCLUDED.policy_version,
           provider = EXCLUDED.provider, model = EXCLUDED.model, model_revision = EXCLUDED.model_revision,
           preset = EXCLUDED.preset, preset_version = EXCLUDED.preset_version,
           width = EXCLUDED.width, height = EXCLUDED.height, mime_type = EXCLUDED.mime_type,
           image_bytes = EXCLUDED.image_bytes, content_sha256 = EXCLUDED.content_sha256,
           created_at = NOW(), expires_at = EXCLUDED.expires_at, hit_count = 0, last_accessed_at = NULL`,
        [
          metadata.cacheKey,
          metadata.promptHash,
          metadata.policyVersion,
          metadata.provider,
          metadata.model,
          metadata.modelRevision,
          metadata.preset,
          metadata.presetVersion,
          metadata.width,
          metadata.height,
          checked.image.mimeType,
          checked.image.bytes,
          checked.image.sha256,
          ttlDays,
        ]
      );
      const updated = await client.query(
        `UPDATE studio_image_usage
            SET status = 'success', actual_cost_usd = COALESCE($2, estimated_cost_usd),
                reservation_expires_at = NULL, completed_at = NOW()
          WHERE id = $1::uuid AND event_type = 'generation' AND status = 'reserved'`,
        [reservationId, actualCost]
      );
      if (updated.rowCount === 0) throw new ImageStoreUnavailableError();
      await client.query("COMMIT");
    } catch {
      await this.rollback(client);
      throw new ImageStoreUnavailableError();
    } finally {
      client.release();
    }
  }

  async fail(
    reservationId: string,
    failureCode: ImageFailureCode,
    options: { httpStatus?: number; actualCostUsd?: number } = {}
  ): Promise<void> {
    const result = await this.pool().query(
      `UPDATE studio_image_usage
          SET status = 'failure', failure_code = $2, http_status = $3,
              actual_cost_usd = COALESCE($4, actual_cost_usd),
              reservation_expires_at = NULL, completed_at = NOW()
        WHERE id = $1::uuid AND event_type = 'generation' AND status = 'reserved'`,
      [
        reservationId,
        failureCode,
        validHttpStatus(options.httpStatus),
        validCost(options.actualCostUsd),
      ]
    );
    if (result.rowCount === 0) throw new ImageStoreUnavailableError();
  }
}
