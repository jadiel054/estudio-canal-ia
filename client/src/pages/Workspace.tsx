import { Link } from "wouter";
import { StudioShell, type Section } from "@/components/StudioShell";
import { ScenePlanPanel } from "@/components/ScenePlanPanel";

/**
 * TEMP: Workspace completo (~96k) não cabe no limite do connector MCP neste turno.
 * Restaurar com:
 *   git show 0a2dd22b:client/src/pages/Workspace.tsx > client/src/pages/Workspace.tsx
 *   # depois reaplicar import ScenePlanPanel + JSX no final do StudioPage
 *   # diff de referência: commit 4bc010d
 */
export default function Workspace({ section }: { section: Section }) {
  return (
    <StudioShell section={section}>
      {section === "estudio" ? (
        <div className="space-y-4 p-4">
          <p className="text-sm text-[#ffd98b]">
            Workspace em modo temporário — só Estúdio / Portão 1.5. Restaure o arquivo completo antes do deploy de produção.
          </p>
          <ScenePlanPanel neonScriptId={1} title="Script Neon #1 (ciclo mock)" />
        </div>
      ) : (
        <div className="grid min-h-[40vh] place-items-center p-6 text-center">
          <div className="max-w-md space-y-3">
            <p className="text-lg font-black text-white">Seção em restauração</p>
            <p className="text-sm text-[#9ba7bd]">
              O arquivo Workspace.tsx completo precisa ser restaurado do commit{" "}
              <code className="text-[#c6ff4d]">0a2dd22b</code> (último estado bom pré-regressão).
            </p>
            <Link href="/estudio" className="inline-block text-sm font-bold text-[#c6ff4d]">
              Ir para Estúdio →
            </Link>
          </div>
        </div>
      )}
    </StudioShell>
  );
}
