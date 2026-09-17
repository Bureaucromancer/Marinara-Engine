// Deleted-message lorebook cascade, part 1: entry provenance.
//
// Agent-written lorebook entries had no message linkage, so deleting the chat
// turn a keeper entry was extracted from left the lore live: later generations
// kept being steered by "facts" from a turn the user removed: an invented
// "current state" claim re-armed every turn by its keys, plus a keeper rewrite
// of an older, innocent entry in place.
//
// Part 1 pins the attribution layer:
//   - createEntry accepts an optional sourceAgentId + sourceMessageRefs and
//     persists them; entries created without them read back as unattributed.
//   - updateEntry on behalf of an agent (sourceAgentId present) snapshots the
//     pre-write content + refs (depth-1 undo, mirroring how addSwipe backfills
//     the outgoing swipe) and stamps the new refs — last write wins.
//   - a content-bearing update WITHOUT provenance is a human edit: attribution
//     is cleared, so the cascade must never touch the entry again.
//
// Part 2 pins the cascade — deleting a message unwinds agent lore:
//   - a rewrite whose last-write turn is deleted reverts to its pre-write
//     snapshot (content + refs), when the snapshot's own sources survive;
//   - a poisoned snapshot (its sources are in the same deletion batch) is
//     discarded first, so the entry deletes instead of reverting to lore
//     whose source is gone;
//   - a keeper create whose only turn is deleted has nothing to revert to
//     and is removed;
//   - deleting an old turn that no longer feeds the current content leaves
//     the entry (and its snapshot) alone;
//   - manual entries and unrelated entries are never touched.
//
// Project imports are DYNAMIC, after the env assignments (see the gallery
// suites for why).
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "marinara-lore-provenance-"));
process.env.DATA_DIR = dir;
process.env.FILE_STORAGE_DIR = join(dir, "storage");
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";

const { getDB, closeDB } = await import("../../packages/server/src/db/connection.js");
const { createLorebooksStorage } = await import("../../packages/server/src/services/storage/lorebooks.storage.js");
const { createChatsStorage } = await import("../../packages/server/src/services/storage/chats.storage.js");

const db = await getDB();
const lorebooks = createLorebooksStorage(db);
const chats = createChatsStorage(db);

try {
  const book = await lorebooks.create({ name: "Provenance lore" });
  assert.ok(book);

  // ── createEntry persists agent attribution + source refs ──
  {
    const created = await lorebooks.createEntry({
      lorebookId: book.id,
      name: "Ledger evidence",
      content: "The ledger shows the curator took the key.",
      keys: ["ledger", "archive"],
      sourceAgentId: "lorebook-keeper",
      sourceMessageRefs: [
        { id: "m-user-1", swipeIndex: null },
        { id: "m-assist-1", swipeIndex: 0 },
      ],
    });
    assert.ok(created, "entry create failed");
    assert.equal(created.sourceAgentId, "lorebook-keeper");
    assert.deepEqual(created.sourceMessageRefs, [
      { id: "m-user-1", swipeIndex: null },
      { id: "m-assist-1", swipeIndex: 0 },
    ]);
    const reread = await lorebooks.getEntry(created.id);
    assert.deepEqual(
      reread?.sourceMessageRefs,
      [
        { id: "m-user-1", swipeIndex: null },
        { id: "m-assist-1", swipeIndex: 0 },
      ],
      "refs must survive the row parse round-trip",
    );
    const listed = await lorebooks.listEntries(book.id);
    assert.ok(listed.some((entry) => entry.id === created.id && entry.sourceAgentId === "lorebook-keeper"));
  }

  // ── createEntry without provenance reads back unattributed ──
  {
    const manual = await lorebooks.createEntry({
      lorebookId: book.id,
      name: "Handwritten",
      content: "Author wrote this.",
      keys: ["hand"],
    });
    assert.ok(manual);
    assert.equal(manual.sourceAgentId, null);
    assert.deepEqual(manual.sourceMessageRefs, []);
  }

  // ── agent rewrite snapshots pre-write state and stamps the new refs ──
  {
    const created = await lorebooks.createEntry({
      lorebookId: book.id,
      name: "Slap rumor",
      content: "Kael is rumored to have defaced a shrine.",
      keys: ["kael", "rumor"],
      sourceAgentId: "lorebook-keeper",
      sourceMessageRefs: [{ id: "m-n", swipeIndex: null }],
    });
    assert.ok(created);
    const updated = await lorebooks.updateEntry(created.id, {
      content: "Kael is rumored to have defaced 3 shrines.",
      sourceAgentId: "lorebook-keeper",
      sourceMessageRefs: [{ id: "m-n10", swipeIndex: 2 }],
    });
    assert.ok(updated);
    assert.deepEqual(updated.sourceMessageRefs, [{ id: "m-n10", swipeIndex: 2 }], "last write wins on refs");
    assert.equal(updated.content, "Kael is rumored to have defaced 3 shrines.");
    const row = (
      await db.select().from((await import("../../packages/server/src/db/schema/lorebooks.js")).lorebookEntries)
    ).find((entry: { id: string }) => entry.id === created.id);
    assert.equal(row.previousContent, "Kael is rumored to have defaced a shrine.", "pre-write content snapshotted");
    assert.deepEqual(
      JSON.parse(row.previousSourceMessageRefs),
      [{ id: "m-n", swipeIndex: null }],
      "pre-write refs snapshotted",
    );
  }

  // ── human content edit clears attribution (cascade immunity) ──
  {
    const created = await lorebooks.createEntry({
      lorebookId: book.id,
      name: "Keeper then human",
      content: "Agent wrote this.",
      keys: ["agent"],
      sourceAgentId: "lorebook-keeper",
      sourceMessageRefs: [{ id: "m-k", swipeIndex: 0 }],
    });
    assert.ok(created);
    const humanEdited = await lorebooks.updateEntry(created.id, {
      content: "Human rewrote this by hand.",
    });
    assert.ok(humanEdited);
    assert.equal(humanEdited.sourceAgentId, null, "human edit takes ownership");
    assert.deepEqual(humanEdited.sourceMessageRefs, []);
    const row = (
      await db.select().from((await import("../../packages/server/src/db/schema/lorebooks.js")).lorebookEntries)
    ).find((entry: { id: string }) => entry.id === created.id);
    assert.equal(row.previousContent, null, "human edit leaves no revert snapshot");
  }

  // ── attribution survives non-content updates (enabled toggles etc.) ──
  {
    const created = await lorebooks.createEntry({
      lorebookId: book.id,
      name: "Toggle me",
      content: "Still agent lore.",
      keys: ["toggle"],
      sourceAgentId: "lorebook-keeper",
      sourceMessageRefs: [{ id: "m-t", swipeIndex: 0 }],
    });
    assert.ok(created);
    const toggled = await lorebooks.updateEntry(created.id, { enabled: false });
    assert.ok(toggled);
    assert.equal(toggled.sourceAgentId, "lorebook-keeper", "non-content PATCH keeps attribution");
    assert.deepEqual(toggled.sourceMessageRefs, [{ id: "m-t", swipeIndex: 0 }]);
  }

  // ── part 2: message-delete cascade ──
  {
    const chat = await chats.create({ name: "Cascade chat", mode: "conversation", characterIds: [] });
    assert.ok(chat);
    const message = (role: "user" | "assistant", content: string) =>
      chats.createMessage({ chatId: chat.id, role, content }).then((row) => row!.id);
    const mN = await message("user", "Kael defaced a shrine.");
    const mAlive = await message("user", "Kael kept out of trouble since.");
    const mN10 = await message("assistant", "Rumor grows: three shrines.");
    const mN10b = await message("assistant", "Rumor grows again.");
    const mGone = await message("assistant", "Invented from whole cloth.");

    // Rewrite whose last-write turn dies → reverts to the snapshot.
    const revertMe = await lorebooks.createEntry({
      lorebookId: book.id,
      name: "Revert me",
      content: "Kael is rumored to have defaced a shrine.",
      keys: ["kael"],
      sourceAgentId: "lorebook-keeper",
      sourceMessageRefs: [{ id: mN, swipeIndex: null }],
    });
    await lorebooks.updateEntry(revertMe!.id, {
      content: "Kael is rumored to have defaced 3 shrines.",
      sourceAgentId: "lorebook-keeper",
      sourceMessageRefs: [{ id: mN10, swipeIndex: 0 }],
    });

    // Keeper create whose only source dies → removed outright.
    const dieAlone = await lorebooks.createEntry({
      lorebookId: book.id,
      name: "Die alone",
      content: "The curator reset the archive clock; the ledger shows proof.",
      keys: ["curator", "ledger"],
      sourceAgentId: "lorebook-keeper",
      sourceMessageRefs: [{ id: mGone, swipeIndex: 0 }],
    });

    // Two rewrites, then BOTH of their turns die in one batch → the snapshot
    // (whose source is also in the batch) is discarded, entry deleted.
    const poisoned = await lorebooks.createEntry({
      lorebookId: book.id,
      name: "Poisoned snapshot",
      content: "First state.",
      keys: ["poison"],
      sourceAgentId: "lorebook-keeper",
      sourceMessageRefs: [{ id: mN, swipeIndex: null }],
    });
    await lorebooks.updateEntry(poisoned!.id, {
      content: "Second state.",
      sourceAgentId: "lorebook-keeper",
      sourceMessageRefs: [{ id: mN10, swipeIndex: 0 }],
    });
    await lorebooks.updateEntry(poisoned!.id, {
      content: "Third state.",
      sourceAgentId: "lorebook-keeper",
      sourceMessageRefs: [{ id: mN10b, swipeIndex: 0 }],
    });

    // Old turn deleted while the current content came from a live turn →
    // entry untouched (its refs no longer mention the deleted message).
    const stillAnchored = await lorebooks.createEntry({
      lorebookId: book.id,
      name: "Still anchored",
      content: "Current state from the surviving turn.",
      keys: ["anchor"],
      sourceAgentId: "lorebook-keeper",
      sourceMessageRefs: [{ id: mAlive, swipeIndex: null }],
    });

    // Manual entry: never touched, whatever dies around it.
    const manual = await lorebooks.createEntry({
      lorebookId: book.id,
      name: "Manual lore",
      content: "Handwritten and immune.",
      keys: ["manual"],
    });

    await chats.removeMessages([mN10, mN10b, mGone], chat.id);

    const reverted = await lorebooks.getEntry(revertMe!.id);
    assert.ok(reverted, "revertable entry survives its deleted rewrite turn");
    assert.equal(reverted.content, "Kael is rumored to have defaced a shrine.", "content reverted to snapshot");
    assert.deepEqual(reverted.sourceMessageRefs, [{ id: mN, swipeIndex: null }], "refs reverted to snapshot refs");

    const dead = await lorebooks.getEntry(dieAlone!.id);
    assert.equal(dead, null, "keeper create whose only turn died is removed");

    const poisonedAfter = await lorebooks.getEntry(poisoned!.id);
    assert.equal(poisonedAfter, null, "poisoned snapshot is discarded, entry removed rather than reverted");

    const anchored = await lorebooks.getEntry(stillAnchored!.id);
    assert.ok(anchored, "entry anchored to a surviving turn is untouched");
    assert.deepEqual(anchored.sourceMessageRefs, [{ id: mAlive, swipeIndex: null }]);

    const manualAfter = await lorebooks.getEntry(manual!.id);
    assert.ok(manualAfter, "manual entry never cascades");

    // Single-message removeMessage path cascades too: the reverted entry's
    // content now sources from mN, so deleting mN deletes it — the snapshot
    // was consumed by the revert, and lore whose source turn is gone must
    // not keep steering generations.
    await chats.removeMessage(mN);
    assert.equal(
      await lorebooks.getEntry(revertMe!.id),
      null,
      "removeMessage cascades; a reverted entry dies when its remaining source dies",
    );
  }

  // ── part 3: the keeper persistence path stamps provenance ──
  {
    const { persistLorebookKeeperUpdates } =
      await import("../../packages/server/src/routes/generate/lorebook-keeper-utils.js");
    const chat = await chats.create({ name: "Keeper stamp chat", mode: "conversation", characterIds: [] });
    assert.ok(chat);
    const targetBook = await lorebooks.create({ name: "Keeper book", chatId: chat.id });
    assert.ok(targetBook);

    // Seed the pre-existing entry the second update rewrites in place.
    const seeded = await lorebooks.createEntry({
      lorebookId: targetBook.id,
      name: "Existing keeper lore",
      content: "Older state.",
      keys: ["rewrite"],
    });
    assert.ok(seeded);

    const returnedTarget = await persistLorebookKeeperUpdates({
      lorebooksStore: lorebooks,
      chatId: chat.id,
      chatName: "Keeper stamp chat",
      preferredTargetLorebookId: targetBook.id,
      writableLorebookIds: [targetBook.id],
      sourceAgentId: "lorebook-keeper",
      sourceMessageRefs: [
        { id: "m-turn-user", swipeIndex: null },
        { id: "m-turn-assist", swipeIndex: 1 },
      ],
      updates: [
        { name: "Fresh keeper lore", content: "Extracted this turn.", keys: ["fresh"] },
        { name: "Existing keeper lore", content: "Rewritten this turn.", keys: ["rewrite"] },
      ],
    });
    assert.equal(returnedTarget, targetBook.id);

    const createdEntry = (await lorebooks.listEntries(targetBook.id)).find((e) => e.name === "Fresh keeper lore");
    assert.ok(createdEntry, "keeper create landed");
    assert.equal(createdEntry.sourceAgentId, "lorebook-keeper", "keeper create is attributed");
    assert.deepEqual(createdEntry.sourceMessageRefs, [
      { id: "m-turn-user", swipeIndex: null },
      { id: "m-turn-assist", swipeIndex: 1 },
    ]);

    const rewrittenEntry = (await lorebooks.listEntries(targetBook.id)).find((e) => e.name === "Existing keeper lore");
    assert.ok(rewrittenEntry);
    assert.equal(rewrittenEntry.content, "Rewritten this turn.");
    assert.equal(rewrittenEntry.sourceAgentId, "lorebook-keeper", "keeper rewrite is attributed");
    assert.deepEqual(rewrittenEntry.sourceMessageRefs, [
      { id: "m-turn-user", swipeIndex: null },
      { id: "m-turn-assist", swipeIndex: 1 },
    ]);
    // And the delete cascade actually reaches keeper-written entries: removing
    // the turn that fed them reverts the rewrite and removes the create.
    await chats.removeMessages(["m-turn-assist"], chat.id);
    const afterCascade = await lorebooks.getEntry(createdEntry.id);
    assert.equal(afterCascade, null, "keeper create is cascaded away with its turn");
    const revertedKeeperEntry = await lorebooks.getEntry(rewrittenEntry.id);
    assert.ok(revertedKeeperEntry, "keeper rewrite reverts instead of vanishing");
    assert.equal(revertedKeeperEntry.content, "Older state.");
  }

  // ── part 4: injection-time staleness for discarded swipes ──
  // A regenerate keeps the message row and swaps the active swipe, so nothing
  // is deleted and the storage cascade never fires. Instead the injection
  // path lazily excludes keeper entries whose anchor swipe is no longer
  // active — and re-includes them when the user swipes back.
  {
    const { processLorebooks } = await import("../../packages/server/src/services/lorebook/index.js");
    const chat = await chats.create({ name: "Swipe chat", mode: "conversation", characterIds: [] });
    assert.ok(chat);
    const userMsg = await chats.createMessage({ chatId: chat.id, role: "user", content: "kael rumor" });
    const assistantMsg = await chats.createMessage({ chatId: chat.id, role: "assistant", content: "kael rumor" });
    assert.ok(userMsg && assistantMsg);
    const book2 = await lorebooks.create({ name: "Swipe book", chatId: chat.id });
    assert.ok(book2);
    const keeperEntry = await lorebooks.createEntry({
      lorebookId: book2.id,
      name: "Swipe-bound lore",
      content: "kael rumor secret from swipe 0",
      keys: ["kael"],
      sourceAgentId: "lorebook-keeper",
      sourceMessageRefs: [{ id: assistantMsg.id, swipeIndex: 0 }],
    });
    const manualEntry = await lorebooks.createEntry({
      lorebookId: book2.id,
      name: "Manual swipe-proof",
      content: "kael rumor handwritten",
      keys: ["kael"],
    });
    assert.ok(keeperEntry && manualEntry);

    const scanMessages = [
      { role: "user", content: "kael rumor" },
      { role: "assistant", content: "kael rumor" },
    ];
    const injectedContents = async () => {
      const result = await processLorebooks(db, scanMessages as never, null, {
        chatId: chat.id,
        activeLorebookIds: [book2.id],
      });
      return `${result.worldInfoBefore}\n${result.worldInfoAfter}`;
    };

    // Swipe 0 is active (fresh message): the entry injects.
    let combined = await injectedContents();
    assert.ok(combined.includes("secret from swipe 0"), "keeper entry injects while its swipe is active");
    assert.ok(combined.includes("handwritten"), "manual entry injects");

    // Regenerate: swipe 1 becomes active. The keeper entry written during
    // swipe 0 must NOT inject — the manual entry still does.
    await chats.addSwipe(assistantMsg.id, "regenerated away from swipe 0");
    await chats.setActiveSwipe(assistantMsg.id, 1);
    combined = await injectedContents();
    assert.ok(!combined.includes("secret from swipe 0"), "stale-swipe keeper entry is excluded from injection");
    assert.ok(combined.includes("handwritten"), "manual entry unaffected by swipe staleness");

    // Swiping back re-arms the entry — nothing was destroyed.
    await chats.setActiveSwipe(assistantMsg.id, 0);
    combined = await injectedContents();
    assert.ok(combined.includes("secret from swipe 0"), "swiping back re-arms the keeper entry");
  }

  // ── an explicit-but-empty refs array still stamps (agent rewrite on a turn
  //    whose anchors were unavailable keeps its attribution + snapshot, so a
  //    later anchored rewrite can still be unwound) ──
  {
    const chat = await chats.create({ name: "Empty refs chat", mode: "conversation", characterIds: [] });
    const book3 = await lorebooks.create({ name: "Empty refs book", chatId: chat!.id });
    assert.ok(chat && book3);
    const entry = await lorebooks.createEntry({
      lorebookId: book3.id,
      name: "Anchored lore",
      content: "First state.",
      keys: ["anchor"],
      sourceAgentId: "lorebook-keeper",
      sourceMessageRefs: [{ id: "m-earlier", swipeIndex: 0 }],
    });
    assert.ok(entry);
    const { persistLorebookKeeperUpdates } =
      await import("../../packages/server/src/routes/generate/lorebook-keeper-utils.js");
    await persistLorebookKeeperUpdates({
      lorebooksStore: lorebooks,
      chatId: chat!.id,
      chatName: "Empty refs chat",
      preferredTargetLorebookId: book3.id,
      writableLorebookIds: [book3.id],
      sourceAgentId: "lorebook-keeper",
      sourceMessageRefs: [],
      updates: [{ name: "Anchored lore", content: "Second state.", keys: ["anchor"] }],
    });
    const rewritten = await lorebooks.getEntry(entry.id);
    assert.ok(rewritten);
    assert.equal(rewritten.sourceAgentId, "lorebook-keeper", "empty refs must not strip attribution");
    assert.deepEqual(rewritten.sourceMessageRefs, []);
    assert.equal(rewritten.content, "Second state.");
    const row = (
      await db.select().from((await import("../../packages/server/src/db/schema/lorebooks.js")).lorebookEntries)
    ).find((candidate: { id: string }) => candidate.id === entry.id);
    assert.equal(row.previousContent, "First state.", "empty-refs rewrite still snapshots");
  }

  console.log("Lorebook entry message provenance regressions passed.");
} finally {
  await closeDB();
  rmSync(dir, { recursive: true, force: true });
}
