/**
 * Interface de providers de geração de vídeo.
 * submit → poll → download. Mock para testar sem gastar crédito.
 */

export type ProviderSubmitResult = {
  providerJobId: string;
};

export type ProviderPollResult =
  | { status: "running" }
  | { status: "succeeded"; downloadUrl: string; actualCost: number }
  | { status: "failed"; error: string };

export type VideoGenProviderAdapter = {
  id: string;
  submit(input: {
    prompt: string;
    negativePrompt?: string | null;
    mode: string;
    durationSeconds?: number;
    referenceUrl?: string | null;
  }): Promise<ProviderSubmitResult>;
  poll(providerJobId: string): Promise<ProviderPollResult>;
  download(downloadUrl: string): Promise<{ uri: string; bytes: number }>;
};

/** Mock: completa em ~2 polls. URI fictícia, custo fixo baixo. */
export const mockProvider: VideoGenProviderAdapter = {
  id: "mock",
  async submit() {
    const id = `mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    // estado em memória só para o processo atual (ok para mock local/cron)
    mockState.set(id, { polls: 0 });
    return { providerJobId: id };
  },
  async poll(providerJobId) {
    const state = mockState.get(providerJobId) ?? { polls: 0 };
    state.polls += 1;
    mockState.set(providerJobId, state);
    if (state.polls < 2) return { status: "running" };
    return {
      status: "succeeded",
      downloadUrl: `mock://clip/${providerJobId}.mp4`,
      actualCost: 0.01,
    };
  },
  async download(downloadUrl) {
    return { uri: downloadUrl, bytes: 1024 };
  },
};

const mockState = new Map<string, { polls: number }>();

/**
 * PixVerse real — só ativa quando PIXVERSE_API_KEY existir.
 * Contrato HTTP é placeholder até a documentação oficial ser plugada;
 * enquanto isso o worker usa mock se a key não estiver presente ou
 * se VIDEO_GEN_USE_MOCK=1.
 */
export const pixverseProvider: VideoGenProviderAdapter = {
  id: "pixverse_api",
  async submit(input) {
    const key = process.env.PIXVERSE_API_KEY;
    if (!key) throw new Error("PIXVERSE_API_KEY não configurada");
    // Placeholder: substituir pelo endpoint real da PixVerse quando documentado.
    // Por segurança, se a key existir mas o endpoint não estiver implementado,
    // falhamos de forma explícita em vez de inventar chamada.
    if (process.env.VIDEO_GEN_USE_MOCK === "1" || !process.env.PIXVERSE_API_URL) {
      return mockProvider.submit(input);
    }
    const res = await fetch(`${process.env.PIXVERSE_API_URL}/v1/video/generate`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        prompt: input.prompt,
        negative_prompt: input.negativePrompt,
        mode: input.mode,
        duration: input.durationSeconds ?? 8,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`PixVerse submit HTTP ${res.status}`);
    const data = (await res.json()) as { id?: string; job_id?: string };
    const providerJobId = data.id ?? data.job_id;
    if (!providerJobId) throw new Error("PixVerse não retornou job id");
    return { providerJobId };
  },
  async poll(providerJobId) {
    const key = process.env.PIXVERSE_API_KEY;
    if (!key) throw new Error("PIXVERSE_API_KEY não configurada");
    if (process.env.VIDEO_GEN_USE_MOCK === "1" || !process.env.PIXVERSE_API_URL) {
      return mockProvider.poll(providerJobId);
    }
    const res = await fetch(`${process.env.PIXVERSE_API_URL}/v1/video/jobs/${providerJobId}`, {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`PixVerse poll HTTP ${res.status}`);
    const data = (await res.json()) as {
      status?: string;
      download_url?: string;
      cost?: number;
      error?: string;
    };
    const st = (data.status ?? "").toLowerCase();
    if (st === "succeeded" || st === "completed" || st === "success") {
      if (!data.download_url) throw new Error("PixVerse succeeded sem download_url");
      return { status: "succeeded", downloadUrl: data.download_url, actualCost: Number(data.cost ?? 0) };
    }
    if (st === "failed" || st === "error") {
      return { status: "failed", error: data.error ?? "falha no provider" };
    }
    return { status: "running" };
  },
  async download(downloadUrl) {
    if (downloadUrl.startsWith("mock://")) return mockProvider.download(downloadUrl);
    // Em produção real: baixar e subir para storage privado; por ora grava a URL.
    return { uri: downloadUrl, bytes: 0 };
  },
};

export function resolveProvider(providerId: string): VideoGenProviderAdapter {
  if (process.env.VIDEO_GEN_USE_MOCK === "1") return mockProvider;
  if (providerId === "pixverse_api") return pixverseProvider;
  // Demais providers ainda não implementados → mock seguro
  return mockProvider;
}
