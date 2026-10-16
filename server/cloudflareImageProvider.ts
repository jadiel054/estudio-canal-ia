import type { ImageProviderAdapter, ImageProviderOutput, ImageProviderRequest } from "./imageGeneration";

const DEFAULT_BASE_URL = "https://api.cloudflare.com/client/v4";
const DEFAULT_TIMEOUT_MS = 30_000;

export class CloudflareImageProviderError extends Error {
  constructor(message: string, readonly httpStatus?: number) {
    super(message);
    this.name = "CloudflareImageProviderError";
  }
}

type CloudflareImageProviderOptions = {
  accountId: string;
  apiToken: string;
  fetcher?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
};

function decodeImage(value: unknown): Uint8Array | undefined {
  if (typeof value !== "string" || value.length < 16) return undefined;
  const base64 = value.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "").trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return undefined;
  try {
    const bytes = Buffer.from(base64, "base64");
    return bytes.length ? new Uint8Array(bytes) : undefined;
  } catch {
    return undefined;
  }
}

function responseImage(payload: unknown): Uint8Array | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const value = payload as Record<string, unknown>;
  const result = value.result && typeof value.result === "object" ? value.result as Record<string, unknown> : undefined;
  return decodeImage(value.image) ?? decodeImage(result?.image) ?? decodeImage(value.response) ?? decodeImage(result?.response);
}

export class CloudflareImageProvider implements ImageProviderAdapter {
  private readonly fetcher: typeof fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly options: CloudflareImageProviderOptions) {
    this.fetcher = options.fetcher ?? fetch;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.timeoutMs = Number.isInteger(options.timeoutMs) && options.timeoutMs! >= 1_000 && options.timeoutMs! <= 120_000 ? options.timeoutMs! : DEFAULT_TIMEOUT_MS;
  }

  async generate(request: ImageProviderRequest): Promise<ImageProviderOutput> {
    const url = `${this.baseUrl}/accounts/${encodeURIComponent(this.options.accountId)}/ai/run/${encodeURIComponent(request.model)}`;
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.options.apiToken}`,
          accept: "application/json, image/*",
          "content-type": "application/json",
        },
        body: JSON.stringify({ prompt: request.visualDirection, width: request.width, height: request.height }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new CloudflareImageProviderError("cloudflare_network_error");
    }

    const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.toLowerCase() ?? "";
    if (!response.ok) throw new CloudflareImageProviderError("cloudflare_http_error", response.status);
    if (contentType.startsWith("image/")) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!bytes.length) throw new CloudflareImageProviderError("cloudflare_empty_image", response.status);
      return { bytes, mimeType: contentType, httpStatus: response.status };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new CloudflareImageProviderError("cloudflare_invalid_response", response.status);
    }
    const bytes = responseImage(payload);
    if (!bytes) throw new CloudflareImageProviderError("cloudflare_image_missing", response.status);
    return { bytes, mimeType: "image/png", httpStatus: response.status };
  }
}

export function createConfiguredCloudflareImageProvider(options: {
  env?: NodeJS.ProcessEnv;
  fetcher?: typeof fetch;
} = {}): CloudflareImageProvider | undefined {
  const env = options.env ?? process.env;
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const apiToken = env.CLOUDFLARE_API_TOKEN?.trim();
  if (!accountId || !apiToken) return undefined;
  return new CloudflareImageProvider({ accountId, apiToken, fetcher: options.fetcher });
}
