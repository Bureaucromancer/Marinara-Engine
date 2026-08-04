// ──────────────────────────────────────────────
// Export: Scenarios
//
// Two lanes. Native keeps every Marinara field; Compatible emits the bare
// object shape the Aventuras scenario vault reads, with Marinara-only
// structure preserved under `metadata.marinara` so a round trip back into
// Marinara is lossless.
//
// Linked lorebooks and characters export as plain ids in both lanes — nothing
// is embedded. Callers warn the user that those links will not resolve on
// another install.
// ──────────────────────────────────────────────
import type { CompatibleScenario, ExportEnvelope, ExportedScenario, Scenario } from "@marinara-engine/shared";
import { toCompatibleScenario } from "@marinara-engine/shared";

/**
 * Wrap a scenario in the standard export envelope.
 *
 * `formatVersion` is synthesized here and has no column: it lets a scenario
 * object still identify itself if it is lifted out of the envelope, and
 * persisting it would mean every row carried a constant only this path can
 * meaningfully change.
 */
export function buildNativeScenarioEnvelope(scenario: Scenario): ExportEnvelope<{ scenario: ExportedScenario }> {
  return {
    type: "marinara_scenario",
    version: 1,
    exportedAt: new Date().toISOString(),
    data: { scenario: { ...scenario, formatVersion: 1 } },
  };
}

/**
 * Thin wrapper over the shared pure mapper, so all conversion logic stays in
 * `packages/shared` where it is testable without a database.
 */
export function buildCompatibleScenarioExport(scenario: Scenario): CompatibleScenario {
  return toCompatibleScenario(scenario);
}

/** True when exporting this scenario will produce links that cannot resolve elsewhere. */
export function scenarioHasExternalLinks(scenario: Scenario): boolean {
  return (
    scenario.lorebookIds.length > 0 ||
    scenario.protagonist?.characterId != null ||
    scenario.npcs.some((npc) => npc.characterId != null)
  );
}
