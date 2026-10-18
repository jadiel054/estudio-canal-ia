import { useMemo, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { ChevronDown, ChevronUp, Clapperboard, Loader2, Save } from "lucide-react";

type Props = {
  /** ID numérico na tabela scripts do Neon (não o UUID do studio_state). */
  neonScriptId: number;
  title?: string;
};

const STATUS_TONE: Record<string, string> = {
  planned: "border-white/15 bg-white/[.04] text-[#aab4c8]",
  approved: "border-[#c6ff4d]/35 bg-[#c6ff4d]/10 text-[#eaffc6]",
  generating: "border-[#8d5cff]/40 bg-[#8d5cff]/12 text-[#cabfff]",
  done: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
  failed: "border-[#ff6b6b]/35 bg-[#ff6b6b]/10 text-[#ffb4b4]",
  queued: "border-white/15 bg-white/[.04] text-[#aab4c8]",
  running: "border-[#ffcf7a]/35 bg-[#ffcf7a]/10 text-[#ffd98b]",
  succeeded: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
  canceled: "border-white/10 text-[#758198]",
};

export function ScenePlanPanel({ neonScriptId, title }: Props) {
  const utils = trpc.useUtils();
  const shotsQuery = trpc.videoGen.shotPlans.useQuery({ scriptId: neonScriptId }, { refetchInterval: 15_000 });
  const jobsQuery = trpc.videoGen.jobs.useQuery({ scriptId: neonScriptId }, { refetchInterval: 10_000 });
  const adaptersQuery = trpc.videoGen.adapters.useQuery();

  const updateShot = trpc.videoGen.updateShotPlan.useMutation({
    onSuccess: async () => {
      await utils.videoGen.shotPlans.invalidate({ scriptId: neonScriptId });
      toast.success("Cena atualizada");
    },
    onError: (error) => toast.error("Falha ao salvar cena", { description: error.message }),
  });

  const dispatch = trpc.videoGen.dispatchJobs.useMutation({
    onSuccess: async (result) => {
      await Promise.all([
        utils.videoGen.shotPlans.invalidate({ scriptId: neonScriptId }),
        utils.videoGen.jobs.invalidate({ scriptId: neonScriptId }),
      ]);
      if (!result.jobs.length) {
        toast.warning(result.message);
        return;
      }
      const total = result.jobs.reduce((s, j) => s + Number(j.estimatedCost), 0);
      toast.success(`${result.jobs.length} job(s) enfileirados`, {
        description: `Provider ${result.provider} · estimado US$ ${total.toFixed(4)}`,
      });
    },
    onError: (error) => {
      const msg = error.message ?? "";
      if (/já tem job|job ativo|duplicate|unique/i.test(msg)) {
        toast.warning("Cena já tem job em andamento", { description: msg });
        return;
      }
      toast.error("Falha ao disparar jobs", { description: msg });
    },
  });

  const shots = shotsQuery.data ?? [];
  const jobs = jobsQuery.data ?? [];
  const estimatedTotal = useMemo(
    () => jobs.filter((j) => j.status === "queued" || j.status === "running").reduce((s, j) => s + Number(j.estimatedCost), 0),
    [jobs],
  );
  const actualTotal = useMemo(
    () => jobs.filter((j) => j.status === "succeeded").reduce((s, j) => s + Number(j.actualCost), 0),
    [jobs],
  );
  const activeAdapter = adaptersQuery.data?.find((a) => a.active);

  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [drafts, setDrafts] = useState<Record<number, { promptText: string; durationSeconds: number }>>({});

  function draftFor(shot: { id: number; promptText: string; durationSeconds: number }) {
    return drafts[shot.id] ?? { promptText: shot.promptText, durationSeconds: shot.durationSeconds };
  }

  function setDraft(id: number, patch: Partial<{ promptText: string; durationSeconds: number }>) {
    setDrafts((prev) => {
      const base = prev[id] ?? {
        promptText: shots.find((s) => s.id === id)?.promptText ?? "",
        durationSeconds: shots.find((s) => s.id === id)?.durationSeconds ?? 8,
      };
      return { ...prev, [id]: { ...base, ...patch } };
    });
  }

  const canEdit = (status: string) => status === "planned" || status === "approved";

  return (
    <section className="mt-6 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-black tracking-[0.18em] text-[#8d5cff]">PORTÃO 1.5 · CENAS</p>
          <h2 className="mt-1 text-lg font-black text-white">
            Plano de cenas{title ? ` · ${title}` : ""}
          </h2>
          <p className="mt-1 max-w-xl text-xs leading-5 text-[#8b98af]">
            Revise e edite os prompts antes de gastar crédito. Script Neon #{neonScriptId}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="rounded-xl border border-white/[.08] bg-white/[.03] px-3 py-2 text-[11px] text-[#aab4c8]">
            Estimado ativo: <strong className="text-white">US$ {estimatedTotal.toFixed(4)}</strong>
            {" · "}
            Real: <strong className="text-[#c6ff4d]">US$ {actualTotal.toFixed(4)}</strong>
          </div>
          <button
            type="button"
            disabled={dispatch.isPending || !shots.length}
            onClick={() => {
              if (!activeAdapter) {
                toast.warning("Nenhum adapter de video_gen ativo", {
                  description: "Ative PixVerse (ou outro) no Neon antes de disparar.",
                });
                return;
              }
              const ok = window.confirm(
                `Aprovar plano e enfileirar jobs no provider ${activeAdapter.provider}?\nCenas: ${shots.length}`,
              );
              if (!ok) return;
              dispatch.mutate({ scriptId: neonScriptId });
            }}
            className="inline-flex items-center gap-2 rounded-xl bg-[#c6ff4d] px-4 py-2.5 text-xs font-black text-[#101421] disabled:opacity-50"
          >
            {dispatch.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Clapperboard className="h-3.5 w-3.5" />}
            Aprovar plano e disparar jobs
          </button>
        </div>
      </div>

      {shotsQuery.isLoading && (
        <p className="text-sm text-[#8b98af]">Carregando cenas…</p>
      )}

      {!shotsQuery.isLoading && !shots.length && (
        <div className="rounded-2xl border border-dashed border-white/12 bg-white/[.02] p-5 text-sm text-[#8b98af]">
          Nenhuma cena neste script. Rode o Diretor de IA (`videoGen.runDirector`) após o Portão 1.
        </div>
      )}

      <div className="grid gap-3">
        {shots.map((shot) => {
          const open = expanded[shot.id] ?? false;
          const draft = draftFor(shot);
          const dirty =
            draft.promptText !== shot.promptText || draft.durationSeconds !== shot.durationSeconds;
          const tone = STATUS_TONE[shot.status] ?? STATUS_TONE.planned;
          return (
            <article
              key={shot.id}
              className="rounded-2xl border border-white/[.08] bg-[#0c1220] p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="grid h-7 w-7 place-items-center rounded-full bg-[#c6ff4d] text-xs font-black text-[#101421]">
                      {shot.sceneNumber}
                    </span>
                    <h3 className="text-sm font-bold text-white">{shot.description}</h3>
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${tone}`}>
                      {shot.status}
                    </span>
                  </div>
                  {shot.cameraNotes && (
                    <p className="mt-1 text-[11px] text-[#758198]">Câmera: {shot.cameraNotes}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setExpanded((e) => ({ ...e, [shot.id]: !open }))}
                  className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-[11px] font-semibold text-[#aab4c8]"
                >
                  {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  Prompt
                </button>
              </div>

              {open && (
                <div className="mt-3 space-y-3 border-t border-white/[.06] pt-3">
                  <label className="block text-[11px] font-bold text-[#8b98af]">
                    Duração (s)
                    <input
                      type="number"
                      min={4}
                      max={15}
                      disabled={!canEdit(shot.status)}
                      value={draft.durationSeconds}
                      onChange={(e) =>
                        setDraft(shot.id, {
                          durationSeconds: Math.min(15, Math.max(4, Number(e.target.value) || 8)),
                        })
                      }
                      className="mt-1 w-24 rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm text-white disabled:opacity-50"
                    />
                  </label>
                  <label className="block text-[11px] font-bold text-[#8b98af]">
                    Prompt (EN)
                    <textarea
                      disabled={!canEdit(shot.status)}
                      value={draft.promptText}
                      onChange={(e) => setDraft(shot.id, { promptText: e.target.value })}
                      rows={4}
                      className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm leading-5 text-[#e8eef8] disabled:opacity-50"
                    />
                  </label>
                  {canEdit(shot.status) && (
                    <button
                      type="button"
                      disabled={!dirty || updateShot.isPending}
                      onClick={() =>
                        updateShot.mutate({
                          id: shot.id,
                          promptText: draft.promptText,
                          durationSeconds: draft.durationSeconds,
                        })
                      }
                      className="inline-flex items-center gap-2 rounded-lg border border-[#c6ff4d]/30 bg-[#c6ff4d]/10 px-3 py-1.5 text-[11px] font-bold text-[#eaffc6] disabled:opacity-40"
                    >
                      <Save size={13} />
                      Salvar cena
                    </button>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>

      <div className="rounded-2xl border border-white/[.08] bg-[#0c1220] p-4">
        <p className="text-[10px] font-black tracking-[0.18em] text-[#8b98af]">JOBS</p>
        <h3 className="mt-1 text-sm font-black text-white">Fila de geração</h3>
        {!jobs.length && (
          <p className="mt-3 text-xs text-[#758198]">Nenhum job ainda. Dispare o plano após revisar as cenas.</p>
        )}
        <div className="mt-3 space-y-2">
          {jobs.map((job) => {
            const tone = STATUS_TONE[job.status] ?? STATUS_TONE.queued;
            return (
              <div
                key={job.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[.06] bg-black/20 px-3 py-2 text-[11px]"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-white">#{job.id}</span>
                  <span className="text-[#8b98af]">{job.provider}</span>
                  <span className={`rounded-full border px-2 py-0.5 font-bold uppercase ${tone}`}>{job.status}</span>
                  {job.error && <span className="text-[#ffaaa3]">{job.error}</span>}
                </div>
                <div className="text-[#aab4c8]">
                  est. <strong className="text-white">US$ {Number(job.estimatedCost).toFixed(4)}</strong>
                  {" · "}
                  real <strong className="text-[#c6ff4d]">US$ {Number(job.actualCost).toFixed(4)}</strong>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
