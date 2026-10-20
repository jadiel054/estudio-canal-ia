import { Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

type RetryButtonProps = {
  onClick: () => void;
  isPending?: boolean;
  label?: string;
  pendingLabel?: string;
  className?: string;
  disabled?: boolean;
};

export function RetryButton({
  onClick,
  isPending = false,
  label = "Tentar novamente",
  pendingLabel = "Tentando\u2026",
  className,
  disabled,
}: RetryButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || isPending}
      className={cn(
        "inline-flex min-h-10 items-center gap-2 rounded-xl border border-white/10 px-3.5 text-xs font-black text-white disabled:opacity-40",
        className,
      )}
    >
      {isPending ? (
        <Loader2 size={14} className="animate-spin" aria-hidden />
      ) : (
        <RefreshCw size={14} aria-hidden />
      )}
      {isPending ? pendingLabel : label}
    </button>
  );
}
