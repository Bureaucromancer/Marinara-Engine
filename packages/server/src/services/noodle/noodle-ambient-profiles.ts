import { AMBIENT_NOODLE_ENTITY_IDS, type NoodleAccount } from "@marinara-engine/shared";
import { createNoodleStorage } from "../storage/noodle.storage.js";

export const AMBIENT_NOODLE_PROFILES = [
  {
    entityId: "random_user:thread-countess",
    displayName: "Thread Countess",
    bio: "Chronically online textile hobbyist who treats every Noodle argument like court gossip.",
  },
  {
    entityId: "random_user:packet-soup",
    displayName: "Packet Soup",
    bio: "Friendly lurker, recipe collector, and accidental drama amplifier.",
  },
  {
    entityId: "random_user:orbit-notice",
    displayName: "Orbit Notice",
    bio: "Posts vague observations, likes too quickly, and follows anyone with interesting chaos.",
  },
  {
    entityId: "random_user:glass-bulletin",
    displayName: "Glass Bulletin",
    bio: "Local rumor account with polished manners and questionable sources.",
  },
  {
    entityId: "random_user:moth-hour",
    displayName: "Moth Hour",
    bio: "Night-scroller who replies with eerie encouragement and niche memes.",
  },
  {
    entityId: "random_user:brine-index",
    displayName: "Brine Index",
    bio: "Overconfident commentator who keeps a spreadsheet of everyone else's scandals.",
  },
] as const;

const AMBIENT_NOODLE_ENTITY_ID_SET = new Set<string>(AMBIENT_NOODLE_ENTITY_IDS);
let ambientSeedQueue: Promise<void> = Promise.resolve();

export function isAmbientNoodleAccount(account: Pick<NoodleAccount, "kind" | "entityId">): boolean {
  return account.kind === "random_user" && AMBIENT_NOODLE_ENTITY_ID_SET.has(account.entityId);
}

export async function ensureAmbientNoodleAccounts(
  noodle: ReturnType<typeof createNoodleStorage>,
  invited: boolean,
): Promise<NoodleAccount[]> {
  let resolveTurn!: () => void;
  const previousTurn = ambientSeedQueue;
  ambientSeedQueue = new Promise<void>((resolve) => {
    resolveTurn = resolve;
  });
  await previousTurn;
  const accounts: NoodleAccount[] = [];
  try {
    for (const profile of AMBIENT_NOODLE_PROFILES) {
      accounts.push(await noodle.upsertAccountFromProfile({ kind: "random_user", ...profile, invited }));
    }
    return accounts;
  } finally {
    resolveTurn();
  }
}
