import { describe, expect, it } from "vitest";
import { executeAgentTool } from "./tools";

describe("Nexo safety tools", () => {
  it("never executes automatic publication directly", async () => {
    const result = await executeAgentTool("alterar_automacao", { etapa: "publicacao", modo: "Automática" });
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]).toMatchObject({ type: "requestConfirmation", subject: "publicacao_automatica" });
    expect(result.actions[0]).toHaveProperty("confirmationId");
    expect(result.summary).toContain("bloqueada");
  });
  it("keeps the other provider as fallback when switching a task", async () => {
    const result = await executeAgentTool("trocar_provedor", { tarefa: "qa", provedor: "groq" });
    expect(result.summary).toContain("reserva");
  });
});
