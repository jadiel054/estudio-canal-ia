import { Link } from "wouter";
import { StudioShell, type Section } from "@/components/StudioShell";
import { ScenePlanPanel } from "@/components/ScenePlanPanel";

export default function Workspace({ section }: { section: Section }) {
  return (
    <StudioShell section={section}>
      <Page section={section} />
    </StudioShell>
  );
}

function Page({ section }: { section: Section }) {
  if (section === "estudio") {
    return (
      <div className="space-y-4 p-1">
        <div>
          <p className="mb-2 text-[10px] font-black uppercase tracking-[.2em] text-[#8d5cff]">MONTAGEM</p>
          <h1 className="text-2xl font-black text-white">Estúdio de produção</h1>
          <p className="mt-2 max-w-2xl text-sm text-[#9ba7bd]">
            Portão 1.5 — revise cenas antes de gastar crédito. Dados de teste no Neon script #1.
          </p>
        </div>
        <ScenePlanPanel neonScriptId={1} title="Script de teste Etapa D" />
        <p className="text-xs text-[#758198]">
          Nota: Workspace completo será restaurado no próximo commit. Esta página prioritiza o Portão 1.5.
        </p>
        <Link href="/fila" className="text-xs font-bold text-[#c6ff4d]">Ver fila →</Link>
      </div>
    );
  }
  return (
    <div className="p-6 text-sm text-[#9ba7bd]">
      Seção “{section}” temporariamente simplificada enquanto o Workspace completo é restaurado.
      Abra <Link href="/estudio" className="text-[#c6ff4d]">Estúdio</Link> para o Portão 1.5.
    </div>
  );
}
