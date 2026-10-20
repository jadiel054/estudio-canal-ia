import type { ReactNode } from "react";
import { EmptyState } from "./EmptyState";
import { ErrorState } from "./ErrorState";
import { LoadingState } from "./LoadingState";

type AsyncStateProps<T> = {
  isLoading?: boolean;
  isError?: boolean;
  isEmpty?: boolean;
  data?: T | null;
  errorTitle?: string;
  errorDescription?: string;
  errorCode?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  loadingLabel?: string;
  onRetry?: () => void;
  children: (data: T) => ReactNode;
  emptyAction?: ReactNode;
};

export function AsyncState<T>({
  isLoading,
  isError,
  isEmpty,
  data,
  errorTitle,
  errorDescription,
  errorCode,
  emptyTitle = "Nada por aqui ainda",
  emptyDescription,
  loadingLabel,
  onRetry,
  children,
  emptyAction,
}: AsyncStateProps<T>) {
  if (isLoading) return <LoadingState label={loadingLabel} />;
  if (isError) {
    return (
      <ErrorState
        title={errorTitle}
        description={errorDescription}
        code={errorCode}
        onRetry={onRetry}
      />
    );
  }
  const empty =
    isEmpty === true ||
    data === null ||
    data === undefined ||
    (Array.isArray(data) && data.length === 0);
  if (empty) {
    return (
      <EmptyState
        title={emptyTitle}
        description={emptyDescription}
        action={emptyAction}
      />
    );
  }
  return <>{children(data as T)}</>;
}
