import { useEffect, useMemo, useState } from "react";
import { Check, CircleAlert, Loader2, RefreshCw, ShieldCheck, Volume2, Wifi } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

const MODELS = [
  { id: "gemini-3.8-flash-tts", label: "Gemini 3.8 Flash TTS" },
  { id: "gemini-3.8-flash-lite-tts", label: "Gemini 3.8 Flash-Lite TTS" },
] as const;
const VOICES = ["Kore", "Aoede", "Charon", "Fenrir", "Orus"] as const;
type Draft = { primaryModel: typeof MODELS[number]["id"]; fallbackModel: typeof MODELS[number]["id"]; voice: typeof VOICES[number] };

export function TTSProviderSettings() {
  const query = trpc.tts.settings.useQuery(undefined, { retry: 1 });
  const utils = trpc.useUtils();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [sampleUrl, setSampleUrl] = useState<string | null>(null);
  const [sampleModel, setSampleModel] = useState("");
  const update = trpc.tts.updateSettings.useMutation({ onSuccess: async () => { toast.success("Configuração de voz salva no Neon"); await utils.tts.settings.invalidate(); }, onError: error => toast.error("Não foi possível salvar a voz", { description: error.message }) });
  const test = trpc.tts.test.useMutation({ onSuccess: result => {
    const bytes = Uint8Array.from(atob(result.audioBase64), character => character.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: result.contentType }));
    setSampleUrl(previous => { if (previous) URL.revokeObjectURL(previous); return url; });
    setSampleModel(`${result.model}${result.fallback ? " · fallback" : ""} · ${result.voice}`);
    toast.success("Amostra de voz pronta", { description: `${result.bytes.toLocaleString("pt-BR")} bytes de áudio. Ouça antes de usar em um vídeo.` });
  }, onError: error => toast.error("A amostra TTS falhou", { description: error.message }) });

  useEffect(() => {
    if (query.data) setDraft({ primaryModel: query.data.primaryModel as Draft["primaryModel"], fallbackModel: query.data.fallbackModel as Draft["fallbackModel"], voice: query.data.voice as Draft["voice"] });
  }, [query.data]);
  useEffect(() => () => { if (sampleUrl) URL.revokeObjectURL(sampleUrl); }, [sampleUrl]);

  const dirty = useMemo(() => Boolean(draft && query.data && (draft.primaryModel !== query.data.primaryModel || draft.fallbackModel !== query.data.fallbackModel || draft.voice !== query.data.voice)), [draft, query.data]);
  const otherModel = (model: Draft["primaryModel"]): Draft["fallbackModel"] => model === MODELS[0].id ? MODELS[1].id : MODELS[0].id;
  const save = () => { if (draft) update.mutate(draft); };

  if (query.isLoading) return <section className="rounded-2xl border border-white/[.075] bg-[#111827]/72 p-5 text-sm text-[#9ba7bd]">Carregando adaptador de voz…</section>;
  if (query.isError || !draft) return <section className="rounded-2xl border border-[#ff7b70]/20 bg-[#ff7b70]/[.06] p-5"><p className="flex items-center gap-2 text-sm font-bold text-[#ffaaa3]"><CircleAlert size={16} /> Configuração TTS indisponível</p><button type="button" onClick={() => query.refetch()} className="mt-3 inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-xs font-black text-white"><RefreshCw size={14} /> Tentar novamente</button></section>;

  return <section className="rounded-2xl border border-white/[.075] bg-[#111827]/72 p-4 shadow-[0_16px_50px_rgba(0,0,0,.12)] sm:p-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="label">VOZ · TTS COM FALLBACK</p><h2 className="mt-1 text-lg font-black text-white">Adaptador de narração</h2><p className="mt-2 max-w-2xl text-xs leading-5 text-[#95a2b8]">Gemini Flash TTS é a opção principal; Flash-Lite é o fallback. O Piper pt-BR não foi habilitado porque a licença comercial dos pesos ainda não está esclarecida.</p></div><ShieldCheck size={20} className="text-[#c6ff4d]" /></div>
    <div className="mt-4 grid gap-3 sm:grid-cols-3">
      <label><span className="field-label">Modelo principal</span><select value={draft.primaryModel} onChange={event => { const primaryModel = event.target.value as Draft["primaryModel"]; setDraft(current => current ? { ...current, primaryModel, fallbackModel: current.fallbackModel === primaryModel ? otherModel(primaryModel) : current.fallbackModel } : current); }} className="input mt-2">{MODELS.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}</select></label>
      <label><span className="field-label">Fallback</span><select value={draft.fallbackModel} onChange={event => { const fallbackModel = event.target.value as Draft["fallbackModel"]; setDraft(current => current ? { ...current, fallbackModel, primaryModel: current.primaryModel === fallbackModel ? otherModel(fallbackModel) : current.primaryModel } : current); }} className="input mt-2">{MODELS.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}</select></label>
      <label><span className="field-label">Voz pré-configurada</span><select value={draft.voice} onChange={event => setDraft(current => current ? { ...current, voice: event.target.value as Draft["voice"] } : current)} className="input mt-2">{VOICES.map(voice => <option key={voice} value={voice}>{voice}</option>)}</select></label>
    </div>
    <div className="mt-4 flex flex-wrap items-center gap-2"><span className={`tag ${query.data?.configured ? "text-[#c6ff4d]" : "text-[#ffd98b]"}`}>{query.data?.configured ? "chave Gemini disponível no servidor" : "chave Gemini ausente"}</span><button type="button" disabled={!query.data?.configured || test.isPending} onClick={() => test.mutate()} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-white/10 px-3.5 text-xs font-black text-[#d8dfed] disabled:opacity-40"><Wifi size={14} />{test.isPending ? <><Loader2 className="animate-spin" size={14} /> Gerando amostra…</> : "Gerar amostra"}</button><button type="button" disabled={!dirty || update.isPending} onClick={save} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#c6ff4d] px-3.5 text-xs font-black text-[#111827] disabled:opacity-40">{update.isPending ? <Loader2 className="animate-spin" size={14} /> : <Check size={14} />} Salvar configuração</button></div>
    {sampleUrl && <div className="mt-4 flex flex-col gap-2 rounded-xl border border-[#c6ff4d]/20 bg-[#c6ff4d]/[.04] p-3 sm:flex-row sm:items-center"><Volume2 size={16} className="text-[#c6ff4d]" /><div className="min-w-0 flex-1"><p className="text-xs font-bold text-white">Amostra · {sampleModel}</p><audio controls src={sampleUrl} className="mt-2 h-9 w-full" /></div></div>}
    <p className="mt-4 rounded-xl border border-[#ffd98b]/18 bg-[#ffd98b]/[.045] p-3 text-[11px] leading-5 text-[#c7b786]"><strong>Privacidade e licença:</strong> o nível gratuito de Gemini TTS está listado sem cobrança na tabela consultada, mas o Google pode usar entradas/saídas para melhoria do serviço e revisão humana. Enviaremos somente texto de roteiro já aprovado; não inclua credenciais, dados pessoais ou material confidencial. O uso comercial é permitido pelos termos aplicáveis, sem exclusividade nem garantia jurídica; confirme a pronúncia PT-BR ouvindo uma amostra.</p>
  </section>;
}
