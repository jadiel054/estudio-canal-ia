import { describe, expect, it } from "vitest";
import { IMAGE_GENERATION_POLICY } from "./imagePolicy";
import {
  PostgresImageStore,
  ImageStoreUnavailableError,
  type ImageRequestMetadata,
} from "./imageCache";
import { validateImagePayload } from "./imageValidation";

function png(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

const metadata: ImageRequestMetadata = {
  cacheKey: "a".repeat(64),
  promptHash: "b".repeat(64),
  policyVersion: IMAGE_GENERATION_POLICY.policyVersion,
  provider: IMAGE_GENERATION_POLICY.provider,
  model: IMAGE_GENERATION_POLICY.model,
  modelRevision: IMAGE_GENERATION_POLICY.modelRevision,
  preset: "tutorial-visual-v1",
  presetVersion: "1",
  width: 320,
  height: 180,
  videoId: "video-test-1",
  jobId: "job-test-1",
  sectionIndex: 0,
};

type DbRow = Record<string, unknown>;
function fakePool(
  handler: (
    sql: string,
    values: unknown[]
  ) => { rows?: DbRow[]; rowCount?: number } = () => ({ rows: [], rowCount: 1 })
) {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const query = async <T = DbRow>(sql: string, values: unknown[] = []) => {
    calls.push({ sql, values });
    const result = handler(sql, values);
    return { rows: (result.rows ?? []) as T[], rowCount: result.rowCount };
  };
  let released = 0;
  const client = {
    query,
    release: () => {
      released += 1;
    },
  };
  const pool = { query, connect: async () => client };
  return {
    pool,
    calls,
    get released() {
      return released;
    },
  };
}

const enabledPolicy = {
  ...IMAGE_GENERATION_POLICY,
  generationAllowed: true,
  licenseApproved: true,
  termsApproved: true,
  modelRevisionPinned: true,
  unitCostUsd: 0.05,
};

describe("persistência visual transacional", () => {
  it("audita miss sem inserir texto visual bruto", async () => {
    const db = fakePool(sql =>
      sql.includes("FROM studio_image_cache")
        ? { rows: [] }
        : { rows: [], rowCount: 1 }
    );
    const store = new PostgresImageStore(() => db.pool);

    await expect(store.lookupAndAudit(metadata)).resolves.toEqual({
      kind: "miss",
    });

    const usageInsert = db.calls.find(call =>
      call.sql.includes("INSERT INTO studio_image_usage")
    );
    expect(usageInsert?.values).toContain("cache_miss");
    expect(usageInsert?.values).not.toContain("Diagrama abstrato de fluxo");
    expect(db.calls.map(call => call.sql.trim().split(/\s+/)[0])).toEqual([
      "BEGIN",
      "DELETE",
      "SELECT",
      "INSERT",
      "COMMIT",
    ]);
    expect(db.released).toBe(1);
  });

  it("audita hit somente depois de verificar hash e dimensões do blob", async () => {
    const image = validateImagePayload({
      bytes: png(320, 180),
      declaredMimeType: "image/png",
      expectedWidth: 320,
      expectedHeight: 180,
      maxBytes: 8 * 1024 * 1024,
    });
    if (!image.ok) throw new Error("fixture inválido");
    const db = fakePool(sql => {
      if (sql.includes("FROM studio_image_cache"))
        return {
          rows: [
            {
              image_bytes: image.image.bytes,
              mime_type: image.image.mimeType,
              width: 320,
              height: 180,
              content_sha256: image.image.sha256,
            },
          ],
        };
      return { rows: [], rowCount: 1 };
    });
    const store = new PostgresImageStore(() => db.pool);

    const result = await store.lookupAndAudit(metadata);

    expect(result.kind).toBe("hit");
    expect(
      db.calls.some(call => call.sql.includes("hit_count = hit_count + 1"))
    ).toBe(true);
    const usageInsert = db.calls.find(call =>
      call.sql.includes("INSERT INTO studio_image_usage")
    );
    expect(usageInsert?.values).toContain("cache_hit");
  });

  it("reserva quota/orçamento sob lock transacional antes de devolver autorização de geração", async () => {
    const db = fakePool(sql => {
      if (sql.includes("FROM studio_image_cache")) return { rows: [] };
      if (sql.includes("SELECT EXISTS") && sql.includes("studio_image_usage"))
        return { rows: [{ active: false }] };
      if (sql.includes("count(*) FILTER"))
        return { rows: [{ attempts: "0", key_attempts: "0", spent_usd: "0" }] };
      if (
        sql.includes("INSERT INTO studio_image_usage") &&
        sql.includes("'generation', 'reserved'")
      )
        return { rows: [{ id: "reservation-1" }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const store = new PostgresImageStore(() => db.pool);

    await expect(store.reserve(metadata, enabledPolicy, 0.05)).resolves.toEqual(
      { kind: "reserved", id: "reservation-1" }
    );

    const sql = db.calls.map(call => call.sql);
    expect(sql[0]).toBe("BEGIN");
    expect(
      sql.findIndex(value => value.includes("pg_advisory_xact_lock"))
    ).toBeLessThan(sql.findIndex(value => value.includes("count(*) FILTER")));
    expect(
      sql.findIndex(value => value.includes("count(*) FILTER"))
    ).toBeLessThan(
      sql.findIndex(value => value.includes("'generation', 'reserved'"))
    );
    expect(sql.at(-1)).toBe("COMMIT");
  });

  it("bloqueia orçamento excedido dentro da mesma transação e não cria reserva", async () => {
    const db = fakePool(sql => {
      if (sql.includes("FROM studio_image_cache")) return { rows: [] };
      if (sql.includes("SELECT EXISTS") && sql.includes("studio_image_usage"))
        return { rows: [{ active: false }] };
      if (sql.includes("count(*) FILTER"))
        return {
          rows: [{ attempts: "1", key_attempts: "0", spent_usd: "0.49" }],
        };
      return { rows: [], rowCount: 1 };
    });
    const store = new PostgresImageStore(() => db.pool);

    await expect(store.reserve(metadata, enabledPolicy, 0.05)).resolves.toEqual(
      { kind: "blocked", code: "budget_exceeded" }
    );
    expect(
      db.calls.some(call => call.sql.includes("'generation', 'reserved'"))
    ).toBe(false);
    expect(
      db.calls.some(
        call =>
          call.sql.includes("INSERT INTO studio_image_usage") &&
          call.values.includes("budget_exceeded")
      )
    ).toBe(true);
    expect(db.calls.at(-1)?.sql).toBe("COMMIT");
  });

  it("falha fechado sem pool configurado", async () => {
    const store = new PostgresImageStore(() => undefined);
    await expect(store.lookupAndAudit(metadata)).rejects.toBeInstanceOf(
      ImageStoreUnavailableError
    );
  });
});
