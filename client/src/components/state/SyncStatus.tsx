import { Cloud, CloudOff, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

type SyncStatusProps = {
  lastSyncedAt?: string | null;
  isSyncing?: boolean;
  isOffline?: boolean;
  onRefresh?: () => void;
  className?: string;
};

function formatSyncedAt(value?: string | null): string {
  if (!value) return "ainda n\u00e3o sincronizado";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "ainda n\u00e3o sincronizado";
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SyncStatus({
  lastSyncedAt,
  isSyncing = false,
  isOffline = false,
  onRefresh,
  className,
}: SyncStatusProps) {
  const label = isOffline
    ? "Sem conex\u00e3o"
    : isSyncing
      ? "Sincronizando\u2026"
      : `Atualizado ${formatSyncedAt(lastSyncedAt)}`;
  const Icon = isOffline ? CloudOff : isSyncing ? RefreshCw : Cloud;
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[10px] font-bold text-[#aeb9ca]",
        className,
      )}
      aria-live="polite"
    >
      <Icon
        size={12}
        className={cn(isSyncing && "animate-spin", isOffline ? "text-[#ffaaa3]" : "text-[#c6ff4d]")}
        aria-hidden
      />
      <span>{label}</span>
      {onRefresh && !isSyncing ? (
        <button
          type="button"
          onClick={onRefresh}
          className="ml-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-black text-white hover:bg-white/10"
        >
          Atualizar
        </button>
      ) : null}
    </div>
  );
}
