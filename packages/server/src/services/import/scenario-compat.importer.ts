// ──────────────────────────────────────────────
// Import: Compatible scenario JSON (Aventuras scenario vault shape)
//
// A bare object with no envelope and no `type` discriminator, so it can only
// be recognised structurally. The mapping itself lives in packages/shared so
// it is testable without a database; this module adds the parts that need one:
// link resolution and persistence.
// ──────────────────────────────────────────────
import type { DB } from "../../db/connection.js";
import { createScenarioSchema, fromCompatibleScenario, isCompatibleScenarioShape } from "@marinara-engine/shared";
import { logger } from "../../lib/logger.js";
import { createScenariosStorage } from "../storage/scenarios.storage.js";
import { resolveScenarioLinks } from "./scenario-links.js";
import { normalizeTimestampOverrides, type TimestampOverrides } from "./import-timestamps.js";

export async function importCompatibleScenario(
  raw: unknown,
  db: DB,
  options?: { originalFilename?: string | null; timestampOverrides?: TimestampOverrides | null },
) {
  if (!isCompatibleScenarioShape(raw)) {
    return { success: false, type: "marinara_scenario" as const, error: "Not a compatible scenario file" };
  }

  const { scenario, warnings } = fromCompatibleScenario(raw, options?.originalFilename ?? null);

  if (!scenario.name) {
    return { success: false, type: "marinara_scenario" as const, error: "Scenario has no name" };
  }

  // Both link kinds resolve through the same helper as the native lane.
  const exportedCharacterIds = scenario.npcs
    .map((npc) => npc.characterId)
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  if (scenario.protagonist?.characterId) exportedCharacterIds.push(scenario.protagonist.characterId);

  const characterNames: Record<string, string> = {};
  for (const npc of scenario.npcs) {
    if (npc.characterId) characterNames[npc.characterId] = npc.name;
  }
  if (scenario.protagonist?.characterId) {
    characterNames[scenario.protagonist.characterId] = scenario.protagonist.name;
  }

  const links = await resolveScenarioLinks(db, {
    lorebookIds: scenario.lorebookIds,
    characterIds: exportedCharacterIds,
    characterNames,
  });

  const remap = (value: string | null) => (value ? (links.characterIds.get(value) ?? null) : null);

  const parsed = createScenarioSchema.safeParse({
    ...scenario,
    lorebookIds: scenario.lorebookIds
      .map((id) => links.lorebookIds.get(id))
      .filter((id): id is string => typeof id === "string"),
    protagonist: scenario.protagonist
      ? { ...scenario.protagonist, characterId: remap(scenario.protagonist.characterId) }
      : null,
    npcs: scenario.npcs.map((npc) => ({ ...npc, characterId: remap(npc.characterId) })),
  });

  if (!parsed.success) {
    return {
      success: false,
      type: "marinara_scenario" as const,
      error: parsed.error.issues[0]?.message ?? "Invalid scenario data",
    };
  }

  const storage = createScenariosStorage(db);
  const created = await storage.create(parsed.data, normalizeTimestampOverrides(options?.timestampOverrides));
  if (!created) {
    return { success: false, type: "marinara_scenario" as const, error: "Failed to create scenario" };
  }

  if (warnings.length > 0) logger.warn("Compatible scenario import warnings: %s", warnings.join("; "));
  if (links.dropped.length > 0) {
    logger.warn("Dropped %d unresolvable scenario link(s) importing %s", links.dropped.length, created.name);
  }

  return {
    success: true,
    type: "marinara_scenario" as const,
    id: created.id,
    name: created.name,
    warnings,
    ...(links.dropped.length > 0 ? { droppedLinks: links.dropped } : {}),
  };
}
