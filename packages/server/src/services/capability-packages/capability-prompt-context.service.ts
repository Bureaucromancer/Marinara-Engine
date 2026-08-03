// ──────────────────────────────────────────────
// Capability prompt-context registry.
//
// Lets an installed package contribute a block of text to the system prompt of a turn, so a package that
// owns live state (a game surface, a tracker, a companion system) can keep the model in sync with what the
// player is actually seeing instead of leaving it to guess.
//
// Gated by the `prompt-context` permission, which already existed in the manifest schema but had no
// mechanism behind it. Contributors are keyed by packageId so re-activation replaces rather than stacks.
//
// Contract: a contributor is called ONCE per generation with a read-only view of the chat, and returns the
// text to append (or null to contribute nothing this turn). It must not mutate anything, and a throw is
// swallowed by the collector — a package must never be able to break a turn.
//
// A contributor may also DECLARE which built-in game systems it replaces with its own (`provides`). The
// built-in prompt then stops asking the model to drive that system, so an experience with its own inventory
// isn't fighting the stock one. Same shape as the client-side chrome declaration: whatever isn't declared
// stays built-in, so a package that wants the host's systems simply says nothing.
// ──────────────────────────────────────────────

import { logger } from "../../lib/logger.js";

/** Read-only view of the turn handed to each contributor. */
export interface CapabilityPromptContextRequest {
  chatId: string;
  /** The chat's metadata record (where game/agent state lives). */
  chatMeta: Record<string, unknown>;
  /** Chat mode, so a contributor can bail out of modes it doesn't serve. */
  mode: string;
}

/** Built-in game systems an experience can declare it replaces. Open set — undeclared stays built-in. */
export interface CapabilityProvidedGameSystems {
  /** The experience tracks items itself ⇒ drop the [inventory:] command and the PLAYER INVENTORY block. */
  inventory?: boolean;
}

/** Rich form of a contribution, for a package that also replaces built-in systems. */
export interface CapabilityPromptContribution {
  text?: string | null;
  provides?: CapabilityProvidedGameSystems;
}

export type CapabilityPromptContextContributor = (
  request: CapabilityPromptContextRequest,
) =>
  | string
  | CapabilityPromptContribution
  | null
  | undefined
  | Promise<string | CapabilityPromptContribution | null | undefined>;

/** What the collector hands the turn: the text blocks plus the union of every `provides` declaration. */
export interface CapabilityPromptContextResult {
  blocks: string[];
  provides: CapabilityProvidedGameSystems;
}

const contributorsByPackage = new Map<string, CapabilityPromptContextContributor>();

/** Register (or replace) the contributor for a package. Returns a releaser for deactivation. */
export function registerCapabilityPromptContext(
  packageId: string,
  contributor: CapabilityPromptContextContributor,
): () => void {
  if (typeof contributor !== "function") throw new Error("Capability prompt-context contributor is invalid");
  contributorsByPackage.set(packageId, contributor);
  return () => {
    if (contributorsByPackage.get(packageId) === contributor) contributorsByPackage.delete(packageId);
  };
}

/**
 * Collect every registered contribution for this turn. Never throws and never returns partial garbage: a
 * contributor that fails or returns nothing is simply skipped, so one bad package can't block generation.
 * Order follows registration order, which is activation order — deterministic across a run.
 */
export async function collectCapabilityPromptContext(
  request: CapabilityPromptContextRequest,
): Promise<CapabilityPromptContextResult> {
  if (contributorsByPackage.size === 0) return { blocks: [], provides: {} };
  const blocks: string[] = [];
  const provides: CapabilityProvidedGameSystems = {};
  for (const [packageId, contribute] of contributorsByPackage) {
    try {
      const contribution = await contribute(request);
      if (contribution === null || contribution === undefined) continue;
      const text = typeof contribution === "string" ? contribution : contribution.text;
      if (typeof text === "string" && text.trim().length > 0) blocks.push(text.trim());
      // Declarations only ever turn a built-in system OFF, so the union is a plain OR: one package
      // replacing inventory is enough, and no package can force another's system back on.
      if (typeof contribution === "object" && contribution.provides?.inventory === true) {
        provides.inventory = true;
      }
    } catch (error) {
      // Non-fatal by design: a broken contributor costs its own context, not the player's turn.
      logger.warn("[capability] prompt-context contributor failed for %s: %s", packageId, String(error));
    }
  }
  return { blocks, provides };
}
