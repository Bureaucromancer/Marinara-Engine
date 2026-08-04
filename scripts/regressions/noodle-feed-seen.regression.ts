// Slice 8f-5: the "new since your last visit" divider and entry-point counter. The timestamp
// is per viewer persona, not per user — NoodleR follows and locked-post access are already
// persona-scoped, so an account-wide value would let visiting as one persona silently clear
// another persona's counter.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { countNoodlerPostsSince } from "../../packages/shared/src/utils/noodler-unseen.js";
import type { NoodlerViewerScope } from "../../packages/shared/src/types/noodle.js";
import type { DB } from "../../packages/server/src/db/connection.js";
import { createFileNativeDB } from "../../packages/server/src/db/file-backed-store.js";
import { createNoodleStorage } from "../../packages/server/src/services/storage/noodle.storage.js";

const storageDir = mkdtempSync(join(tmpdir(), "marinara-noodle-feed-seen-"));
process.env.FILE_STORAGE_DIR = storageDir;
const fileDb = await createFileNativeDB();

try {
  const noodle = createNoodleStorage(fileDb as unknown as DB);

  // ── The timestamp survives a storage round-trip, and is scoped to one persona ──
  const viewerA = await noodle.upsertAccountFromProfile({
    kind: "persona",
    entityId: "feed-seen-persona-a",
    displayName: "Viewer A",
  });
  const viewerB = await noodle.upsertAccountFromProfile({
    kind: "persona",
    entityId: "feed-seen-persona-b",
    displayName: "Viewer B",
  });
  assert.equal(viewerA.settings.social.noodlerFeedSeenAt, undefined, "a fresh persona has never been shown the feed");

  const seenAt = "2026-08-04T10:00:00.000Z";
  const patched = await noodle.patchAccountSettings(viewerA.id, {
    subtree: "social",
    patch: { noodlerFeedSeenAt: seenAt },
  });
  assert.equal(patched?.settings.social.noodlerFeedSeenAt, seenAt, "the timestamp must persist");
  const reloadedA = await noodle.getAccountById(viewerA.id);
  assert.equal(reloadedA?.settings.social.noodlerFeedSeenAt, seenAt, "and survive a reload");
  const reloadedB = await noodle.getAccountById(viewerB.id);
  assert.equal(
    reloadedB?.settings.social.noodlerFeedSeenAt,
    undefined,
    "one persona's visit must not clear another's counter",
  );

  // ── Counting rules ──
  const post = (id: string, createdAt: string) => ({ id, createdAt }) as NoodlerViewerScope["creators"][number]["posts"][number];
  const scope = {
    viewer: reloadedA!,
    creators: [
      {
        profile: { id: "creator-1", noodleAccountId: null },
        subscribed: false,
        followed: true,
        posts: [post("new-1", "2026-08-04T12:00:00.000Z"), post("old-1", "2026-08-04T09:00:00.000Z")],
      },
      {
        // The viewer's own stage profile: their own posts are never "new" to them.
        profile: { id: "creator-own", noodleAccountId: viewerA.id },
        subscribed: false,
        followed: false,
        posts: [post("own-new", "2026-08-04T13:00:00.000Z")],
      },
    ],
  } as unknown as NoodlerViewerScope;

  assert.equal(countNoodlerPostsSince(scope, seenAt), 1, "only other creators' newer posts count");
  assert.equal(
    countNoodlerPostsSince(scope, undefined),
    0,
    "a persona that has never been shown the feed must not be handed the whole backlog",
  );
  assert.equal(countNoodlerPostsSince(undefined, seenAt), 0, "no scope means nothing to count");
  assert.equal(countNoodlerPostsSince(scope, "not-a-date"), 0, "an unparseable timestamp must not count everything");
  assert.equal(
    countNoodlerPostsSince(scope, "2026-08-04T12:00:00.000Z"),
    0,
    "a post exactly at the seen timestamp was already shown",
  );

  console.log("noodle-feed-seen: OK");
} finally {
  rmSync(storageDir, { recursive: true, force: true });
}
