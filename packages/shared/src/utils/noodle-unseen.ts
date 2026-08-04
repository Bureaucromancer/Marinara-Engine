import type { NoodlerViewerScope } from "../types/noodle.js";

/**
 * How many of these activity timestamps land after `seenAt`.
 *
 * No stored timestamp means this viewer has never had the feed shown to them, so nothing
 * counts as new — the counter stays silent on first run rather than announcing the whole
 * backlog. An unparseable value is treated the same way, never as "everything is new".
 *
 * Callers pass the timestamp their feed is *sorted* by, which is not always `createdAt`:
 * public Noodle orders by latest activity, so creation time here would put the divider
 * somewhere other than the boundary the reader actually sees.
 */
export function countActivityAfter(activityAtMs: number[], seenAt: string | undefined): number {
  if (!seenAt) return 0;
  const seen = new Date(seenAt).getTime();
  if (Number.isNaN(seen)) return 0;
  return activityAtMs.filter((at) => at > seen).length;
}

/**
 * Posts a viewer persona has not been shown yet on NoodleR: newer than that persona's stored
 * `noodlerFeedSeenAt`, excluding its own stage profile's posts, which are never "new" to the
 * person who just wrote them.
 */
export function countNoodlerPostsSince(scope: NoodlerViewerScope | undefined, seenAt: string | undefined): number {
  if (!scope) return 0;
  return countActivityAfter(
    scope.creators
      .filter((creator) => creator.profile.noodleAccountId !== scope.viewer.id)
      .flatMap((creator) => creator.posts.map((post) => new Date(post.createdAt).getTime())),
    seenAt,
  );
}
