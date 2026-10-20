import { ListFilter } from "lucide-react";
import { StudioShell } from "@/components/StudioShell";
import { useStudio } from "@/store/StudioStore";

/** Logs com custo honesto: sem sugerir que R$ 0,00 é medição de produção. */
export default function LogsRoute() {
  return (
    <StudioShell section="logs">
      <LogsPage />
    </StudioShell>
  );
}

function LogsPage() {
  const { audit } = useStudio();

  return (
    <>
      <header className="mb-6 sm:mb-8">
        <p className="mb-2 text-[10px] font-black uppercase tracking-[.2em] text-[#8d5cff]">
          OBSERVABILIDADE
        </p>
        <h1 className="text-2xl font-black tracking-tight text-white sm:text-3xl">Logs e custos</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[#9ba7bd]">
          Toda decisão de Nexo e toda transição de etapa ficam rastreáveis. Nunca são gravados
          tokens, chaves ou conteúdo de segredos.
        </p>
      </header>

      <div className="grid gap-5 xl:grid-cols-[.7fr_1.3fr]">
        <section className="rounded-2xl border border-white/[.075] bg-[#111827]/72 p-5">
          <p className="text-[10px] font-black uppercase tracking-[.16em] text-[#8d5cff]">
            Custo por vídeo
          </p>
          <div className="mt-5 text-center">
            <p className="text-4xl font-black text-[#c6ff4d]">—</p>
            <p className="mt-2 text-xs text-[#8e9bb2]">
              Sem medição de custo em produção ainda
            </p>
          </div>
          <div className="mt-4 rounded-xl border border-[#ffd98b]/20 bg-[#ffd98b]/[.06] p-3 text-xs leading-5 text-[#ead39e]">
            <strong>Modo de validação:</strong> adaptadores gratuitos e providers opcionais não
            geram fatura consolidada nesta tela. Quando houver billing real, os valores aparecerão
            aqui com fonte e período.
          </div>
          <div className="mt-5 space-y-3 border-t border-white/[.07] pt-4 text-xs">
            <CostRow label="Pesquisa" value="não medido" />
            <CostRow label="Roteiro / QA" value="não medido" />
            <CostRow label="Voz / render" value="não medido" />
            <CostRow label="Upload YouTube" value="bloqueado" />
          </div>
        </section>

        <section className="rounded-2xl border border-white/[.075] bg-[#111827]/72 p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[.16em] text-[#8d5cff]">
                Auditoria
              </p>
              <h2 className="mt-1 text-lg font-black text-white">Últimas ações</h2>
            </div>
            <ListFilter size={19} className="text-[#8d5cff]" aria-hidden />
          </div>
          <div className="mt-4 divide-y divide-white/[.06]">
            {audit.length === 0 ? (
              <p className="py-6 text-center text-xs text-[#8e9bb2]">Nenhum evento de auditoria ainda.</p>
            ) : (
              audit.map(entry => (
                <div key={entry.id} className="flex gap-3 py-3 first:pt-0">
                  <span
                    className={`mt-1.5 h-2 w-2 rounded-full ${
                      entry.actor === "Nexo"
                        ? "bg-[#8d5cff]"
                        : entry.actor === "Você"
                          ? "bg-[#c6ff4d]"
                          : "bg-[#ffd98b]"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap justify-between gap-1">
                      <p className="text-xs font-bold text-[#e0e6f1]">
                        <span className="text-[#a9b5c8]">{entry.actor}</span> · {entry.action}
                      </p>
                      <span className="text-[10px] text-[#78859a]">{entry.at}</span>
                    </div>
                    <p className="mt-1 truncate text-xs text-[#95a1b7]">
                      {entry.example && (
                        <span className="mr-1.5 font-black text-[#ffd98b]">EXEMPLO</span>
                      )}
                      {entry.target}
                      {entry.detail ? ` — ${entry.detail}` : ""}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </>
  );
}

function CostRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-[#97a3b8]">{label}</span>
      <span className="font-bold text-[#e1e7f3]">{value}</span>
    </div>
  );
}
