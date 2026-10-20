import type { ReactNode } from "react";
import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

type EmptyStateProps = {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
};

/** Estado vazio honesto — sem números fictícios. */
export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
}: EmptyStateProps) {
  return (
    <section
      className={cn(
        "rounded-2xl border border-white/[.075] bg-[#111827]/72 p-6 text-center",
        className,
      )}
    >
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-white/[.04] text-[#8e9bb0]">
        {icon ?? <Inbox size={22} aria-hidden />}
      </div>
      <h3 className="mt-4 text-sm font-black text-white">{title}</h3>
      {description ? (
        <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-[#95a2b8]">{description}</p>
      ) : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </section>
  );
}
