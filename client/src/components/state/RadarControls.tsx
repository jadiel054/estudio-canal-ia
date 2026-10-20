import { RefreshCw } from "lucide-react";
import { AsyncState } from "./AsyncState";
import { MutationButton } from "./MutationButton";
import { SyncStatus } from "./SyncStatus";

type RadarControlsProps = {
  lastSyncedAt?: string | null;
  isSyncing: boolean;
  canRefresh: boolean;
  isPending: boolean;
  onRefresh: () => void;
};

/** Controles de sync/atualizar do Radar — piloto dos componentes de estado. */
export function RadarControls({
  lastSyncedAt,
  isSyncing,
  canRefresh,
  isPending,
  onRefresh,
}: RadarControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SyncStatus
        lastSyncedAt={lastSyncedAt}
        isSyncing={isSyncing}
        onRefresh={canRefresh ? onRefresh : undefined}
      />
      <MutationButton
        variant="secondary"
        disabled={!canRefresh}
        isPending={isPending}
        pendingLabel="Coletando\u2026"
        onClick={onRefresh}
      >
        <RefreshCw size={15} /> Atualizar agora
      </MutationButton>
    </div>
  );
}

type RadarQueryBannerProps = {
  isError: boolean;
  isLoading: boolean;
  onRetry: () => void;
};

export function RadarQueryBanner({ isError, isLoading, onRetry }: RadarQueryBannerProps) {
  if (isError) {
    return (
      <div className="mb-4">
        <AsyncState
          isError
          errorTitle="Radar indispon\u00edvel"
          errorDescription="N\u00e3o foi poss\u00edvel carregar os sinais agora. Verifique a conex\u00e3o com o Neon e tente de novo."
          errorCode="RADAR_QUERY_FAILED"
          onRetry={onRetry}
        >
          {() => null}
        </AsyncState>
      </div>
    );
  }
  if (isLoading) {
    return (
      <div className="mb-4">
        <AsyncState isLoading loadingLabel="Carregando sinais do Radar\u2026">
          {() => null}
        </AsyncState>
      </div>
    );
  }
  return null;
}
