import { useState } from "react";
import { CalendarClock, RadioTower, Zap } from "lucide-react";
import { toast } from "sonner";
import { StudioShell } from "@/components/StudioShell";

/** Lives: fase 1 explícita — Premiere rascunho local, sem RTMP real. */
export default function LivesRoute() {
  return (
    <StudioShell section="lives">
      <LivesPage />
    </StudioShell>
  );
}

function LivesPage() {
  const [date, setDate] = useState("");

  return (
    <>
      <header className="mb-6 sm:mb-8">
        <p className="mb-2 text-[10px] font-black uppercase tracking-[.2em] text-[#8d5cff]">
          AO VIVO · FASE 1
        </p>
        <h1 className="text-2xl font-black tracking-tight text-white sm:text-3xl">
          Lives começam como Estreias
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[#9ba7bd]">
          Use um vídeo já aprovado como Premiere. RTMP e live 24/7 permanecem preparados, mas
          exigem infraestrutura e confirmação — ainda não estão ativos.
        </p>
      </header>

      <div className="mb-4 rounded-xl border border-[#ffd98b]/25 bg-[#ffd98b]/[.06] p-3 text-xs leading-5 text-[#ead39e]">
        <strong>Protótipo operacional:</strong> criar rascunho de estreia só registra a intenção
        localmente. Não agenda no YouTube nem abre sinal RTMP.
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.05fr_.95fr]">
        <section className="relative overflow-hidden rounded-2xl border border-white/[.075] bg-[#111827]/72 p-5">
          <span className="inline-flex rounded-md border border-[#ffaaa3]/30 bg-[#ffaaa3]/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-[#ffaaa3]">
            Premiere · rascunho
          </span>
          <h2 className="mt-4 text-xl font-black text-white">Agende a primeira Estreia</h2>
          <p className="mt-2 max-w-lg text-sm leading-6 text-[#98a5bb]">
            A Premiere usará um vídeo final aprovado e o mesmo Portão 2. É a forma mais segura de
            validar o formato ao vivo antes de RTMP.
          </p>
          <label className="mt-5 block text-xs font-bold text-[#9ba7bd]">Data e horário</label>
          <input
            type="datetime-local"
            value={date}
            onChange={event => setDate(event.target.value)}
            className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white"
          />
          <button
            type="button"
            className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#c6ff4d] px-3.5 text-xs font-black text-[#111827]"
            onClick={() =>
              date
                ? toast.message("Rascunho local apenas", {
                    description:
                      "Data registrada neste aparelho. A agenda YouTube só será usada quando a integração de estreia estiver pronta.",
                  })
                : toast.error("Escolha data e horário")
            }
          >
            <CalendarClock size={15} /> Criar rascunho de estreia
          </button>
        </section>

        <section className="rounded-2xl border border-white/[.075] bg-[#111827]/72 p-5">
          <p className="text-[10px] font-black uppercase tracking-[.16em] text-[#8d5cff]">
            Próximas fases · bloqueadas
          </p>
          <div className="mt-4 space-y-3">
            <FutureFeature
              icon={<RadioTower size={17} />}
              title="RTMP com OBS ou FFmpeg"
              detail="Bloqueado até teste de sinal, chave RTMP e confirmação de início."
            />
            <FutureFeature
              icon={<Zap size={17} />}
              title="Canal ao vivo 24/7"
              detail="Depende de VPS, custo aprovado e monitoramento de saúde."
            />
          </div>
        </section>
      </div>
    </>
  );
}

function FutureFeature({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) {
  return (
    <div className="flex gap-3 rounded-xl border border-white/[.06] bg-white/[.025] p-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/[.04] text-[#8e9bb0]">
        {icon}
      </span>
      <div>
        <p className="text-sm font-bold text-white">{title}</p>
        <p className="mt-1 text-xs leading-5 text-[#95a2b8]">{detail}</p>
      </div>
    </div>
  );
}
