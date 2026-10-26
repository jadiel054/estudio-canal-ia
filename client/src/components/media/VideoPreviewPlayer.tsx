import { useState } from "react";
import { Download, RefreshCw, Video } from "lucide-react";
import { cn } from "@/lib/utils";

type VideoPreviewPlayerProps = {
  src: string;
  downloadHref?: string;
  fileLabel?: string;
  className?: string;
};

/**
 * Player de prévia com tratamento de erro e fallback de download.
 * credentials: include via cookie de sessão nas rotas /api/render/*.
 */
export function VideoPreviewPlayer({
  src,
  downloadHref,
  fileLabel,
  className,
}: VideoPreviewPlayerProps) {
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  if (failed) {
    return (
      <div
        className={cn(
          "rounded-xl border border-[#ff7b70]/25 bg-[#ff7b70]/[.06] p-4",
          className,
        )}
        role="alert"
      >
        <p className="flex items-center gap-2 text-sm font-bold text-[#ffaaa3]">
          <Video size={16} aria-hidden /> Não foi possível reproduzir a prévia
        </p>
        <p className="mt-2 text-xs leading-5 text-[#c9a8a4]">
          A sessão pode ter expirado, o arquivo pode ter sido limpo ou o formato não é suportado
          neste aparelho.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setFailed(false);
              setReloadKey(key => key + 1);
            }}
            className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-white/10 px-3 text-[11px] font-black text-white"
          >
            <RefreshCw size={12} aria-hidden /> Tentar de novo
          </button>
          {downloadHref ? (
            <a
              href={downloadHref}
              className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-[#c6ff4d] px-3 text-[11px] font-black text-[#111827]"
            >
              <Download size={12} aria-hidden /> Baixar MP4
            </a>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      <video
        key={`${src}:${reloadKey}`}
        className="w-full rounded-xl bg-black"
        controls
        playsInline
        preload="metadata"
        src={src}
        onError={() => setFailed(true)}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        {fileLabel ? <p className="text-xs text-[#9aa7bb]">{fileLabel}</p> : <span />}
        {downloadHref ? (
          <a
            href={downloadHref}
            className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-white/12 bg-white/[.06] px-3 text-xs font-black text-[#e7ecf6]"
          >
            <Download size={14} aria-hidden /> Baixar MP4
          </a>
        ) : null}
      </div>
    </div>
  );
}
