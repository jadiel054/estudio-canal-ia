import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type MutationButtonProps = {
  onClick: () => void;
  isPending?: boolean;
  disabled?: boolean;
  children: ReactNode;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "danger";
  className?: string;
  title?: string;
};

const variants: Record<NonNullable<MutationButtonProps["variant"]>, string> = {
  primary: "bg-[#c6ff4d] text-[#111827]",
  secondary: "border border-white/10 text-[#d8dfed]",
  danger: "border border-[#ff7b70]/30 bg-[#ff7b70]/10 text-[#ffaaa3]",
};

export function MutationButton({
  onClick,
  isPending = false,
  disabled,
  children,
  pendingLabel,
  variant = "primary",
  className,
  title,
}: MutationButtonProps) {
  return (
    <button
      type="button"
      title={title}
      onClick={() => {
        if (isPending || disabled) return;
        onClick();
      }}
      disabled={disabled || isPending}
      aria-busy={isPending}
      className={cn(
        "inline-flex min-h-10 items-center gap-2 rounded-xl px-3.5 text-xs font-black disabled:opacity-40",
        variants[variant],
        className,
      )}
    >
      {isPending ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null}
      {isPending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
