import { CircleAlert, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

type ErrorStateProps = {
  title?: string;
  description?: string;
  /** Código estável para suporte (ex.: RADAR_UNAVAILABLE). Não incluir stack/token. */
  code?: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
};

/**
 * Estado de erro sanitizado em PT-BR.
 * Nunca renderiza stack, token, prompt ou mensagem upstream bruta.
 */
export function ErrorState({
  title = "Algo deu errado",
  description = "Não foi possível carregar estes dados agora. Tente de novo em instantes.",
  code,
  onRetry,
  retryLabel = "Tentar novamente",
  className,
}: ErrorStateProps) {
  return (
    <section
      role="alert"
      aria-live="assertive"
      className={cn(
        "rounded-2xl border border-[#ff7b70]/20 bg-[#ff7b70]/[.06] p-5",
        className,
      )}
    >
      <p className="flex items-center gap-2 text-sm font-bold text-[#ffaaa3]">
        <CircleAlert size={16} aria-hidden />
        {title}
      </p>
      <p className="mt-2 text-xs leading-5 text-[#c9a8a4]">{description}</p>
      {code ? (
        <p className="mt-2 text-[10px] font-mono uppercase tracking-wide text-[#9a7f7b]">
          Código: {code}
        </p>
      ) : null}
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-xl border border-white/10 px-3.5 text-xs font-black text-white"
        >
          <RefreshCw size={14} aria-hidden />
          {retryLabel}
        </button>
      ) : null}
    </section>
  );
}
