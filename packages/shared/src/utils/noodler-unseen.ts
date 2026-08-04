import type { NoodlerViewerScope } from "../types/noodle.js";

/**
 * Posts a viewer persona has not been shown yet: newer than that persona's stored
 * `noodlerFeedSeenAt`, excluding its own stage profile's posts, which are never "new" to the
 * person who just wrote them.
 *
 * A persona with no stored timestamp has never had the feed shown to it, so nothing counts as
 * new — the counter stays silent on first run rather than announcing the whole backlog.
 */
export function countNoodlerPostsSince(scope: NoodlerViewerScope | undefined, seenAt: string | undefined): number {
  if (!scope || !seenAt) return 0;
  const seen = new Date(seenAt).getTime();
  if (Number.isNaN(seen)) return 0;
  return scope.creators.reduce(
    (total, creator) =>
      creator.profile.noodleAccountId === scope.viewer.id
        ? total
        : total + creator.posts.filter((post) => new Date(post.createdAt).getTime() > seen).length,
    0,
  );
}
