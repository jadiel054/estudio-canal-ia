import { trpc } from "@/lib/trpc";
import { useCallback, useMemo } from "react";

export function useAuth() {
  const utils = trpc.useUtils();
  const meQuery = trpc.auth.me.useQuery(undefined, { retry: false, refetchOnWindowFocus: false });
  const logoutMutation = trpc.auth.logout.useMutation({ onSuccess: () => utils.auth.me.setData(undefined, null) });
  const state = useMemo(() => ({ user: meQuery.data ?? null, loading: meQuery.isLoading || logoutMutation.isPending, error: meQuery.error ?? logoutMutation.error ?? null, isAuthenticated: Boolean(meQuery.data) }), [meQuery.data, meQuery.error, meQuery.isLoading, logoutMutation.error, logoutMutation.isPending]);
  const logout = useCallback(async () => { await logoutMutation.mutateAsync(); await utils.auth.me.invalidate(); }, [logoutMutation, utils]);
  return { ...state, refresh: () => meQuery.refetch(), logout };
}
