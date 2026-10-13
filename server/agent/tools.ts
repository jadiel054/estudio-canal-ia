import { z } from "zod";
import { appendStudioAudit, studioPersistenceStatus } from "../studioRepository";
import type { AgentAction } from "../../client/src/data/studio";

const stage = z.enum(["radar", "roteiro", "producao", "publicacao"]);
const provider = z.enum(["gemini", "groq"]);
export const agentTools = [
  { name: "consultar_fila", description: "Consulta o estado resumido da fila editorial, sem alterar dados.", parameters: { type: "object", properties: {}, additionalProperties: false } },
  { name: "alterar_automacao", description: "Altera uma única etapa entre Automática e Manual. Não habilita publicação automática.", parameters: { type: "object", properties: { etapa: { type: "string", enum: stage.options }, modo: { type: "string", enum: ["Automática", "Manual"] } }, required: ["etapa", "modo"], additionalProperties: false } },
  { name: "criar_pauta", description: "Cria uma pauta em Pesquisa. Só use quando o usuário pedir explicitamente para criar uma pauta.", parameters: { type: "object", properties: { titulo: { type: "string", minLength: 3, maxLength: 180 }, formato: { type: "string", enum: ["Longo", "Short", "Live"] } }, required: ["titulo", "formato"], additionalProperties: false } },
  { name: "trocar_provedor", description: "Seleciona Gemini ou Groq para uma tarefa específica, sem revelar chaves.", parameters: { type: "object", properties: { tarefa: { type: "string", enum: ["roteiro", "qa", "agente", "leve"] }, provedor: { type: "string", enum: provider.options } }, required: ["tarefa", "provedor"], additionalProperties: false } },
  { name: "solicitar_confirmacao", description: "Solicita confirmação antes de publicação automática, aumento de teto ou exclusão de dados.", parameters: { type: "object", properties: { acao: { type: "string", enum: ["publicacao_automatica", "aumentar_teto", "apagar_dados"] }, descricao: { type: "string", minLength: 10, maxLength: 500 } }, required: ["acao", "descricao"], additionalProperties: false } },
] as const;
const schemas = {
  consultar_fila: z.object({}),
  alterar_automacao: z.object({ etapa: stage, modo: z.enum(["Automática", "Manual"]) }),
  criar_pauta: z.object({ titulo: z.string().trim().min(3).max(180), formato: z.enum(["Longo", "Short", "Live"]) }),
  trocar_provedor: z.object({ tarefa: z.enum(["roteiro", "qa", "agente", "leve"]), provedor: provider }),
  solicitar_confirmacao: z.object({ acao: z.enum(["publicacao_automatica", "aumentar_teto", "apagar_dados"]), descricao: z.string().trim().min(10).max(500) }),
};

type ToolResult = { summary: string; actions: AgentAction[]; confirmationRequired?: { subject: string; description: string } };
export async function executeAgentTool(name: string, rawArgs: Record<string, unknown>): Promise<ToolResult> {
  if (!(name in schemas)) return { summary: "Ferramenta desconhecida; nenhuma alteração foi feita.", actions: [] };
  const parsed = schemas[name as keyof typeof schemas].safeParse(rawArgs);
  if (!parsed.success) return { summary: "Parâmetros inválidos; nenhuma alteração foi feita.", actions: [] };
  const args = parsed.data as any;
  if (name === "consultar_fila") { return { summary: `Fila consultada. ${studioPersistenceStatus().detail}`, actions: [] }; }
  if (name === "alterar_automacao") {
    const action = { type: "setAutomation" as const, key: args.etapa, value: args.modo }; await appendStudioAudit({ actor: "Nexo", action: "Automação atualizada por ferramenta", target: args.etapa, details: { value: args.modo } }); return { summary: `A etapa ${args.etapa} foi alterada para ${args.modo} e registrada no log.`, actions: [action] };
  }
  if (name === "criar_pauta") {
    const action = { type: "createIdea" as const, title: args.titulo, format: args.formato, origin: "Agente" as const }; await appendStudioAudit({ actor: "Nexo", action: "Pauta criada por ferramenta", target: args.titulo, details: { format: args.formato } }); return { summary: `A pauta “${args.titulo}” foi criada em Pesquisa.`, actions: [action] };
  }
  if (name === "trocar_provedor") { await appendStudioAudit({ actor: "Nexo", action: "Provedor solicitado", target: args.tarefa, details: { provider: args.provedor } }); return { summary: `A preferência de ${args.tarefa} foi registrada para ${args.provedor}.`, actions: [] }; }
  return { summary: "A ação é sensível e não foi executada. A confirmação explícita do dono é necessária.", actions: [{ type: "requestConfirmation", subject: args.acao, description: args.descricao }], confirmationRequired: { subject: args.acao, description: args.descricao } };
}
