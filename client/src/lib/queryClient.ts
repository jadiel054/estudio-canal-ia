import { QueryClient } from "@tanstack/react-query";

/**
 * QueryClient do Estúdio.
 * - refetch ao focar a janela (dados deixam de ficar stale silenciosos)
 * - staleTime curto: polling de 15s do studio.state continua útil, mas focus também revalida
 */
export function createAppQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        refetchOnWindowFocus: true,
        staleTime: 10_000,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}
