import type { ReactNode } from "react";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type ConfirmActionProps = {
  label: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  description: string;
  onConfirm: () => void | Promise<void>;
  isPending?: boolean;
  variant?: "primary" | "danger";
  className?: string;
};

export function ConfirmAction({
  label,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  description,
  onConfirm,
  isPending = false,
  variant = "danger",
  className,
}: ConfirmActionProps) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex min-h-10 items-center gap-2 rounded-xl border px-3.5 text-xs font-black",
          variant === "danger"
            ? "border-[#ff7b70]/30 bg-[#ff7b70]/10 text-[#ffaaa3]"
            : "border-white/10 text-white",
          className,
        )}
      >
        {label}
      </button>
    );
  }
  return (
    <div role="group" aria-label="Confirma\u00e7\u00e3o" className={cn("rounded-xl border border-white/10 bg-black/30 p-3", className)}>
      <p className="text-xs leading-5 text-[#c7d0e0]">{description}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={async () => {
            await onConfirm();
            setOpen(false);
          }}
          className={cn(
            "inline-flex min-h-9 items-center gap-2 rounded-lg px-3 text-xs font-black disabled:opacity-40",
            variant === "danger" ? "bg-[#ff7b70] text-[#1a0a09]" : "bg-[#c6ff4d] text-[#111827]",
          )}
        >
          {isPending ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null}
          {confirmLabel}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => setOpen(false)}
          className="inline-flex min-h-9 items-center rounded-lg border border-white/10 px-3 text-xs font-black text-[#d8dfed] disabled:opacity-40"
        >
          {cancelLabel}
        </button>
      </div>
    </div>
  );
}
