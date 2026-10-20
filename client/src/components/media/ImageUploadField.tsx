import { useRef, useState } from "react";
import { ImagePlus, Loader2, RefreshCw, X } from "lucide-react";
import { cn } from "@/lib/utils";

const ALLOWED = ["image/png", "image/jpeg", "image/webp"] as const;
export type AllowedImageType = (typeof ALLOWED)[number];

export type ImageUploadPayload = {
  fileName: string;
  contentType: AllowedImageType;
  base64: string;
  width: number;
  height: number;
  bytes: number;
};

type ImageUploadFieldProps = {
  disabled?: boolean;
  isUploading?: boolean;
  maxBytes?: number;
  maxDimension?: number;
  acceptCapture?: boolean;
  onUpload: (payload: ImageUploadPayload) => void | Promise<void>;
  className?: string;
  label?: string;
  helpText?: string;
};

function normalizeType(type: string): AllowedImageType | null {
  if (type === "image/jpg") return "image/jpeg";
  if (ALLOWED.includes(type as AllowedImageType)) return type as AllowedImageType;
  return null;
}

async function readImage(file: File, maxBytes: number, maxDimension: number): Promise<ImageUploadPayload> {
  const contentType = normalizeType(file.type);
  if (!contentType) {
    throw new Error("Formato não suportado. Use PNG, JPG ou WebP.");
  }
  if (file.size > maxBytes) {
    throw new Error(`A imagem excede ${Math.round(maxBytes / (1024 * 1024))} MB.`);
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  });

  const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] ?? "" : "";
  if (!base64) throw new Error("Codificação da imagem inválida.");

  const dims = await new Promise<{ width: number; height: number }>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("Arquivo de imagem inválido."));
    img.src = dataUrl;
  });

  if (dims.width > maxDimension || dims.height > maxDimension) {
    throw new Error(`Dimensão máxima: ${maxDimension}px (recebido ${dims.width}×${dims.height}).`);
  }

  return {
    fileName: file.name,
    contentType,
    base64,
    width: dims.width,
    height: dims.height,
    bytes: file.size,
  };
}

/**
 * Upload de captura com preview, progresso de leitura, validação MIME/tamanho/dimensão e retry.
 */
export function ImageUploadField({
  disabled,
  isUploading,
  maxBytes = 2 * 1024 * 1024,
  maxDimension = 4096,
  acceptCapture = true,
  onUpload,
  className,
  label = "Captura de tela",
  helpText = "PNG, JPG ou WebP · até 2 MB",
}: ImageUploadFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [meta, setMeta] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "reading" | "ready" | "uploading">("idle");
  const [lastFile, setLastFile] = useState<File | null>(null);

  const busy = disabled || isUploading || phase === "reading" || phase === "uploading";

  const processFile = async (file: File) => {
    setError(null);
    setLastFile(file);
    setPhase("reading");
    try {
      const payload = await readImage(file, maxBytes, maxDimension);
      const url = URL.createObjectURL(file);
      setPreviewUrl(prev => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
      setMeta(`${payload.width}×${payload.height} · ${Math.round(payload.bytes / 1024)} KB · ${payload.contentType.replace("image/", "")}`);
      setPhase("uploading");
      await onUpload(payload);
      setPhase("ready");
    } catch (err) {
      setPhase("idle");
      setError(err instanceof Error ? err.message : "Falha no upload");
    }
  };

  return (
    <div className={cn("rounded-2xl border border-white/[.075] bg-[#111827]/72 p-4", className)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-black text-white">{label}</p>
          <p className="mt-1 text-xs text-[#95a2b8]">{helpText}</p>
        </div>
        {(phase === "reading" || isUploading || phase === "uploading") && (
          <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-[#c6ff4d]">
            <Loader2 size={12} className="animate-spin" aria-hidden />
            {phase === "reading" ? "Lendo…" : "Enviando…"}
          </span>
        )}
      </div>

      {previewUrl ? (
        <div className="relative mt-3 overflow-hidden rounded-xl border border-white/10 bg-black/40">
          <img src={previewUrl} alt="Prévia da captura" className="max-h-48 w-full object-contain" />
          <button
            type="button"
            aria-label="Remover prévia"
            disabled={busy}
            onClick={() => {
              if (previewUrl) URL.revokeObjectURL(previewUrl);
              setPreviewUrl(null);
              setMeta(null);
              setPhase("idle");
              setLastFile(null);
            }}
            className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-lg bg-black/60 text-white disabled:opacity-40"
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="mt-3 flex min-h-28 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 bg-white/[.03] text-xs font-bold text-[#aeb9ca] disabled:opacity-40"
        >
          <ImagePlus size={22} className="text-[#c6ff4d]" aria-hidden />
          Escolher imagem
        </button>
      )}

      {meta ? <p className="mt-2 text-[11px] text-[#8e9bb2]">{meta}</p> : null}

      {error ? (
        <div className="mt-3 rounded-xl border border-[#ff7b70]/25 bg-[#ff7b70]/[.06] p-3" role="alert">
          <p className="text-xs text-[#ffaaa3]">{error}</p>
          {lastFile ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void processFile(lastFile)}
              className="mt-2 inline-flex min-h-9 items-center gap-2 rounded-lg border border-white/10 px-3 text-[11px] font-black text-white disabled:opacity-40"
            >
              <RefreshCw size={12} aria-hidden /> Tentar novamente
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-white/10 px-3 text-[11px] font-black text-white disabled:opacity-40"
        >
          <ImagePlus size={13} aria-hidden /> {previewUrl ? "Trocar imagem" : "Selecionar"}
        </button>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        capture={acceptCapture ? "environment" : undefined}
        className="hidden"
        disabled={busy}
        onChange={event => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void processFile(file);
        }}
      />
    </div>
  );
}
