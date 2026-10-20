import { Link } from "wouter";
import { BarChart3, Link2, RefreshCw } from "lucide-react";
import { EmptyState } from "@/components/state";
import { StudioShell } from "@/components/StudioShell";
import { trpc } from "@/lib/trpc";

/**
 * Analytics honesto: sem gráficos ou métricas fictícias como se fossem reais.
 * Até existir coleta autenticada, mostra vazio + CTA de integração.
 */
export default function AnalyticsRoute() {
  return (
    <StudioShell section="analytics">
      <AnalyticsPage />
    </StudioShell>
  );
}

function AnalyticsPage() {
  const youtube = trpc.studio.youtubeConnection.useQuery(undefined, {
    retry: 1,
    refetchOnWindowFocus: true,
  });
  const connected = Boolean(youtube.data?.connected);

  return (
    <>
      <header className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 text-[10px] font-black uppercase tracking-[.2em] text-[#8d5cff]">
            APRENDIZADO CONTÍNUO
          </p>
          <h1 className="text-2xl font-black tracking-tight text-white sm:text-3xl">
            Analytics
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#9ba7bd]">
            Métricas só aparecem aqui quando houver coleta real do YouTube. Nada nesta tela
            inventa views, CTR ou retenção.
          </p>
        </div>
        <Link
          href="/integracoes"
          className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-white/12 bg-white/[.06] px-3.5 text-xs font-black text-[#e7ecf6]"
        >
          <Link2 size={14} /> Integrações
        </Link>
      </header>

      <EmptyState
        title={connected ? "Nenhum dado Analytics coletado" : "Analytics ainda não disponível"}
        description={
          connected
            ? "A conexão YouTube existe, mas ainda não há pipeline de coleta de métricas em produção. Quando o collector estiver ativo, os números reais aparecerão aqui."
            : "Conecte o YouTube em modo somente leitura nas Integrações e rode o diagnóstico. Até lá, esta tela permanece vazia de propósito."
        }
        icon={<BarChart3 size={22} aria-hidden />}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Link
              href="/integracoes"
              className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#c6ff4d] px-3.5 text-xs font-black text-[#111827]"
            >
              <Link2 size={14} /> {connected ? "Ver conexão YouTube" : "Conectar YouTube"}
            </Link>
            <button
              type="button"
              onClick={() => void youtube.refetch()}
              className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-white/10 px-3.5 text-xs font-black text-white"
            >
              <RefreshCw size={14} /> Atualizar status
            </button>
          </div>
        }
      />

      <p className="mt-4 text-center text-[11px] text-[#6f7c93]">
        Gráficos e cards de demonstração foram removidos para não parecerem dados de produção.
      </p>
    </>
  );
}
