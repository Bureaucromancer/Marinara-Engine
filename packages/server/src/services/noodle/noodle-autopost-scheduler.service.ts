// ──────────────────────────────────────────────
// NoodleR per-creator automatic-posting scheduler.
// Polls enabled creator accounts, claims a due run by advancing its server-owned
// nextRunAt before provider work, then drives the same NoodleR-post application
// operation as user-triggered generation. Text-only, subscriber access.
// ──────────────────────────────────────────────
import type { FastifyInstance } from "fastify";
import { logger } from "../../lib/logger.js";
import { createNoodleStorage } from "../storage/noodle.storage.js";
import { generateAndApplyNoodlerPost } from "./noodle-noodler-post.operation.js";
import { isConnectionAdmissionFailure } from "../generation/connection-admission.js";
import { getErrorMessage } from "./noodle-public-support.js";

const AUTOPOST_INITIAL_DELAY_MS = 20_000;
const AUTOPOST_POLL_MS = 60_000;
const MAX_CONCURRENT_AUTOPOSTS = 2;

export function startNoodleAutoPostScheduler(app: FastifyInstance) {
  const noodle = createNoodleStorage(app.db);
  const inFlight = new Set<Promise<void>>();
  let stopped = false;
  let polling = false;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  // Tracks the currently-running poll so shutdown can await a poll that has already claimed
  // work (and registered it in inFlight) before draining, instead of racing storage close.
  let activePoll: Promise<void> = Promise.resolve();

  const scheduleNext = (delayMs = AUTOPOST_POLL_MS) => {
    if (stopped) return;
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(() => {
      activePoll = poll();
    }, delayMs);
    pollTimer.unref?.();
  };

  const runGeneration = async (accountId: string): Promise<void> => {
    // nextRunAt was already advanced to a future slot by the claim, so any outcome here
    // — success, provider failure, or transient miss — simply waits a full cadence
    // interval before the next attempt. That advance is the anti-hot-loop guarantee;
    // no extra backoff map is needed.
    try {
      const result = await generateAndApplyNoodlerPost(
        app.db,
        { mode: "noodler", targetAccountId: accountId, access: "subscriber" },
        undefined,
        // Automatic posting is the background half of the priority rule: it must never take a
        // connection a user is generating on, and it waits out the post-generation idle window.
        { kind: "background" },
      );
      if (result.status !== "generated") {
        logger.warn("[noodle-autopost] Skipped creator %s automatic post: %s", accountId, result.status);
      }
    } catch (err) {
      // A busy connection is the designed outcome, not a fault; the claim already moved
      // nextRunAt forward, so the creator simply tries again next cadence.
      if (isConnectionAdmissionFailure(err)) {
        logger.info("[noodle-autopost] Deferred creator %s automatic post: %s", accountId, getErrorMessage(err));
        return;
      }
      logger.error(err, "[noodle-autopost] Automatic post failed for creator %s", accountId);
    }
  };

  const poll = async () => {
    if (stopped || polling) return;
    polling = true;
    try {
      const settings = await noodle.getSettings();
      // Master schedule switch pauses automatic posting without disabling NoodleR itself.
      if (!settings.enableNoodler || !settings.autoPostingScheduleEnabled) return;
      const accounts = await noodle.listAutoPostEnabledAccounts();
      const nowIso = new Date().toISOString();
      for (const account of accounts) {
        if (stopped) break;
        if (inFlight.size >= MAX_CONCURRENT_AUTOPOSTS) break;
        const auto = account.settings.scheduler.autoPosting;
        if (!auto?.enabled) continue;
        // Cheap due-check before any write.
        if (auto.nextRunAt !== null && Date.parse(auto.nextRunAt) > Date.parse(nowIso)) continue;
        // The next slot is derived inside the claim transaction from the current intensity.
        const outcome = await noodle.advanceAutoPostRun(account.id, nowIso);
        // "seeded" gives a freshly enabled creator its first future slot without posting;
        // only "claimed" means a due run was consumed and should generate now.
        if (outcome !== "claimed") continue;
        const task = runGeneration(account.id).finally(() => {
          inFlight.delete(task);
        });
        inFlight.add(task);
      }
    } catch (err) {
      logger.error(err, "[noodle-autopost] Poll failed");
    } finally {
      polling = false;
      scheduleNext();
    }
  };

  const stop = () => {
    stopped = true;
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
  };

  scheduleNext(AUTOPOST_INITIAL_DELAY_MS);
  app.addHook("onClose", async () => {
    // Stop the timer, await any in-progress poll so a run it just claimed is registered in
    // inFlight, then drain active generations before storage closes. Fastify runs onClose
    // hooks LIFO, so this (registered after the closeDB hook) completes first.
    stop();
    await activePoll.catch(() => {});
    await Promise.allSettled([...inFlight]);
  });

  logger.info("[noodle-autopost] Per-creator automatic-posting scheduler started");

  return { stop };
}
