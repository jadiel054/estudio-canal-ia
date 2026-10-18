/**
 * Ponte Portão 1 (roteiro aprovado na UI/studio_state) → tabelas relacionais Neon.
 *
 * Contrato para a UI (Jules):
 *   studio.persistApprovedScript
 *     input:  { content: string; title?: string; ideaId?: number | null; studioScriptId?: string }
 *     output: { scriptId: number; reviewId: number; status: "approved" }
 *
 * Em seguida a UI chama:
 *   videoGen.runDirector({ scriptId, scriptContent, title? })
 *   videoGen.dispatchJobs({ scriptId, videoId? })
 */
import { getStudioPool, appendStudioAudit } from "./studioRepository";

export type PersistApprovedScriptInput = {
  content: string;
  title?: string;
  /** idea_id relacional (nullable). */
  ideaId?: number | null;
  /** ID string do script no studio_state (só para auditoria). */
  studioScriptId?: string;
  actor?: "Você" | "Nexo";
};

export type PersistApprovedScriptResult = {
  scriptId: number;
  reviewId: number;
  status: "approved";
};

/**
 * Grava o roteiro aprovado em `scripts` (status=approved) e registra o Portão 1 em `reviews`.
 * Não exige coluna `origin` — idea_id nullable cobre o fluxo studio.
 */
export async function persistApprovedScript(
  input: PersistApprovedScriptInput,
): Promise<PersistApprovedScriptResult> {
  const content = (input.content ?? "").trim();
  if (content.length < 40) {
    throw new Error("Roteiro muito curto para persistir (mínimo 40 caracteres).");
  }
  if (content.length > 100_000) {
    throw new Error("Roteiro excede o limite de 100.000 caracteres.");
  }

  const pool = getStudioPool();
  if (!pool) {
    throw new Error("Neon não configurado (STUDIO_DATABASE_URL ausente).");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const scriptResult = await client.query<{ id: string }>(
      `INSERT INTO scripts (idea_id, version, content, status, approved_at)
       VALUES ($1, 1, $2, 'approved', NOW())
       RETURNING id`,
      [input.ideaId ?? null, content],
    );
    const scriptId = Number(scriptResult.rows[0]?.id);
    if (!Number.isFinite(scriptId) || scriptId <= 0) {
      throw new Error("Falha ao inserir script no Neon.");
    }

    const reviewResult = await client.query<{ id: string }>(
      `INSERT INTO reviews (target_type, target_id, gate, decision, comment)
       VALUES ('script', $1, 1, 'approved', $2)
       RETURNING id`,
      [
        scriptId,
        input.title
          ? `Portão 1 aprovado: ${input.title.slice(0, 200)}`
          : "Portão 1 aprovado via studio.persistApprovedScript",
      ],
    );
    const reviewId = Number(reviewResult.rows[0]?.id);
    if (!Number.isFinite(reviewId) || reviewId <= 0) {
      throw new Error("Falha ao registrar review do Portão 1.");
    }

    await client.query("COMMIT");

    await appendStudioAudit({
      actor: input.actor ?? "Você",
      action: "Roteiro aprovado persistido no Neon",
      target: `script:${scriptId}`,
      details: {
        scriptId,
        reviewId,
        studioScriptId: input.studioScriptId ?? null,
        ideaId: input.ideaId ?? null,
        title: input.title ?? null,
        contentLength: content.length,
      },
    });

    return { scriptId, reviewId, status: "approved" };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw error;
  } finally {
    client.release();
  }
}
