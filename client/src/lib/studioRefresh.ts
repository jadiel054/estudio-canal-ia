import type { trpc } from "./trpc";

type Utils = ReturnType<typeof trpc.useUtils>;

export type StudioRefreshDomain = "all" | "state" | "radar" | "youtube" | "videoGen";

/**
 * Invalida queries por domínio.
 * Preferir isto a espalhar invalidate() ad-hoc nas páginas.
 */
export async function invalidateStudioQueries(
  utils: Utils,
  domain: StudioRefreshDomain = "all",
): Promise<void> {
  const tasks: Array<Promise<unknown>> = [];

  if (domain === "all" || domain === "state") {
    tasks.push(utils.studio.state.invalidate());
  }
  if (domain === "all" || domain === "radar") {
    tasks.push(utils.studio.radar.invalidate());
  }
  if (domain === "all" || domain === "youtube") {
    tasks.push(utils.studio.youtubeConnection.invalidate());
  }
  if (domain === "all" || domain === "videoGen") {
    // shotPlans é parametrizado; invalidar a raiz cobre as listas ativas.
    tasks.push(utils.videoGen.invalidate());
  }

  await Promise.all(tasks);
}
