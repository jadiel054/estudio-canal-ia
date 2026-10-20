import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type LoadingStateProps = {
  label?: string;
  className?: string;
};

/** Loading discreto alinhado ao visual do Estúdio. */
export function LoadingState({
  label = "Carregando…",
  className,
}: LoadingStateProps) {
  return (
    <section
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-center gap-3 rounded-2xl border border-white/[.075] bg-[#111827]/72 p-5 text-sm text-[#9ba7bd]",
        className,
      )}
    >
      <Loader2 size={16} className="animate-spin text-[#c6ff4d]" aria-hidden />
      <span>{label}</span>
    </section>
  );
}
