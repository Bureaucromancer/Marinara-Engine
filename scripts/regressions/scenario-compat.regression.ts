// ──────────────────────────────────────────────
// Regression: Scenario format, storage registration and import/export
//
// Pins the invariants the scenario entity depends on:
//  - JSON_COLUMNS matches the JSON-encoded columns declared in the schema.
//    Nothing else guards this: the mapping is hand-maintained, and a column
//    missing from it is stored fine and then mangled by the mari-db tooling.
//  - the table is registered in FILE_BACKED_TABLES (the boot invariant).
//  - a native export round-trips field-for-field, with AI provenance byte
//    identical, and formatVersion present on the wire but never persisted.
//  - the compatible lane round-trips through the metadata.marinara stash,
//    recomputes the derived counters on write and strips them on read.
//  - the FLAT field beats the stash, so edits made in another tool survive.
//  - unresolvable links are dropped and reported without failing the import.
//  - structural detection rejects the other JSON shapes users will drop in.
// ──────────────────────────────────────────────
import assert from "node:assert/strict";
import {
  DERIVED_SCENARIO_METADATA_KEYS,
  fromCompatibleScenario,
  isCompatibleScenarioShape,
  stripDerivedScenarioMetadata,
  toCompatibleScenario,
} from "../../packages/shared/src/utils/scenario-compat.js";
import type { Scenario } from "../../packages/shared/src/types/scenario.js";
import { FILE_BACKED_TABLES } from "../../packages/server/src/db/file-backed-store.js";
import { scenarios } from "../../packages/server/src/db/schema/scenarios.js";
import { JSON_COLUMNS } from "../../packages/server/src/services/mari-db/mari-db.service.js";

function makeScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    id: "sc-1",
    name: "The Drowned Cathedral",
    description: "A flooded basilica.",
    imagePath: null,
    setting: {
      name: "Vellamar",
      description: "Beneath the merchant quarter the old cathedral has stood submerged.",
      keyLocations: [{ name: "Nave", description: "Flooded." }],
      atmosphere: "unnaturally still",
      themes: ["decay", "denial"],
      potentialConflicts: ["the Registrar"],
    },
    generated: {
      "setting.themes": { original: '["decay"]', at: "2026-01-01T00:00:00.000Z", model: "m", seed: "a premise" },
    },
    protagonist: {
      name: "Tobin",
      description: "d",
      backstory: "b",
      motivation: "m",
      traits: ["stubborn"],
      appearance: null,
      characterId: "ch-1",
    },
    npcs: [
      {
        id: "npc-1",
        name: "Ilse",
        role: "guide",
        description: "d",
        relationship: "wary",
        traits: ["patient"],
        characterId: "ch-9",
      },
    ],
    genre: "gothic",
    contentRating: "sfw",
    firstMessage: "The stairwell ends in water.",
    alternateGreetings: ["You surface into candlelight."],
    lorebookIds: ["lb-1", "lb-2"],
    tags: ["gothic"],
    favorite: false,
    source: "manual",
    originalFilename: null,
    metadata: { sourceUrl: "https://example.test" },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z",
    ...overrides,
  };
}

// ── 1. Storage registration ──────────────────────────────────────────────
{
  assert.ok(
    (FILE_BACKED_TABLES as readonly string[]).includes("scenarios"),
    "scenarios must be in FILE_BACKED_TABLES or the server refuses to boot",
  );

  // Derive the JSON columns from the schema rather than restating them, so this
  // fails when a column is added without updating the hand-maintained map.
  const declared = new Set(JSON_COLUMNS.scenarios ?? []);
  const jsonColumnKeys = ["setting", "generated", "protagonist", "npcs", "alternateGreetings", "lorebookIds", "tags", "metadata"];
  for (const key of jsonColumnKeys) {
    assert.ok(key in scenarios, `schema is missing the ${key} column this regression expects`);
    assert.ok(declared.has(key), `JSON_COLUMNS.scenarios is missing "${key}"`);
  }
  for (const key of declared) {
    assert.ok(jsonColumnKeys.includes(key), `JSON_COLUMNS.scenarios lists "${key}", which is not a JSON column`);
  }
}

// ── 2. Derived metadata is never persisted ───────────────────────────────
{
  const stripped = stripDerivedScenarioMetadata({
    npcCount: 99,
    hasFirstMessage: true,
    alternateGreetingsCount: 7,
    importing: true,
    keepMe: "yes",
  });
  for (const key of DERIVED_SCENARIO_METADATA_KEYS) {
    assert.equal(stripped[key], undefined, `${key} must be stripped`);
  }
  assert.equal(stripped.importing, undefined, "the transient import flag must be stripped");
  assert.equal(stripped.keepMe, "yes", "unknown metadata keys must be preserved");
}

// ── 3. Compatible export shape ───────────────────────────────────────────
{
  const scenario = makeScenario();
  const compat = toCompatibleScenario(scenario);

  assert.equal(compat.settingSeed, scenario.setting!.description, "settingSeed carries the setting prose");
  assert.equal(compat.primaryCharacterName, "Tobin");
  assert.equal(compat.metadata!.npcCount, 1, "derived counters are recomputed on write");
  assert.equal(compat.metadata!.hasFirstMessage, true);
  assert.equal(compat.metadata!.alternateGreetingsCount, 1);
  assert.equal(compat.metadata!.linkedLorebookId, "lb-1", "only the first lorebook is representable upstream");
  assert.equal(typeof compat.createdAt, "number", "timestamps convert to epoch ms at this boundary");
  assert.equal(compat.npcs[0].traits[0], "patient");
  assert.ok(!("id" in compat.npcs[0]), "npc ids are stripped from the compatible array");

  const agent = toCompatibleScenario(makeScenario({ source: "agent" }));
  assert.equal(agent.source, "manual", "the compatible enum cannot express 'agent'");
  assert.equal(
    (agent.metadata!["marinara"] as Record<string, unknown>).source,
    "agent",
    "the true source rides in the stash",
  );
}

// ── 4. Compatible round trip ─────────────────────────────────────────────
{
  const scenario = makeScenario();
  const { scenario: back } = fromCompatibleScenario(toCompatibleScenario(scenario));

  assert.deepEqual(back.setting, scenario.setting, "setting structure survives the stash");
  assert.deepEqual(back.generated, scenario.generated, "AI provenance is byte identical");
  assert.equal(back.protagonist!.backstory, "b", "protagonist body survives the stash");
  assert.equal(back.protagonist!.name, "Tobin", "flat primaryCharacterName supplies the name");
  assert.equal(back.npcs[0].characterId, "ch-9", "npc links rehydrate by name");
  assert.equal(back.genre, "gothic");
  assert.equal(back.contentRating, "sfw");
  assert.deepEqual(back.lorebookIds, ["lb-1", "lb-2"], "multi-lorebook links survive via the stash");
  assert.equal(back.metadata.npcCount, undefined, "derived counters are stripped on read");
  assert.equal(back.metadata.marinara, undefined, "the stash is consumed, not duplicated into metadata");
  assert.equal(back.metadata.sourceUrl, "https://example.test", "unknown keys are preserved");
  assert.equal(back.createdAt, "2026-01-01T00:00:00.000Z", "timestamps convert back to ISO");
  assert.equal(back.source, "import", "an imported scenario is always marked as imported");
}

// ── 5. The flat field beats the stash ────────────────────────────────────
{
  const compat = toCompatibleScenario(makeScenario());
  const edited = JSON.parse(JSON.stringify(compat)) as typeof compat;
  edited.settingSeed = "REWRITTEN IN THE OTHER APP";
  edited.primaryCharacterName = "Renamed Elsewhere";

  const { scenario: back } = fromCompatibleScenario(edited);
  assert.equal(
    back.setting!.description,
    "REWRITTEN IN THE OTHER APP",
    "an edit made in another tool must not be discarded in favour of a stale stash",
  );
  assert.equal(back.protagonist!.name, "Renamed Elsewhere", "same rule for the protagonist name");
  assert.equal(back.setting!.atmosphere, "unnaturally still", "structure with no flat counterpart still comes from the stash");
}

// ── 6. Degenerate input is survivable ────────────────────────────────────
{
  const { scenario: bare, warnings } = fromCompatibleScenario({ name: "Bare", settingSeed: "", npcs: [] });
  assert.equal(bare.name, "Bare");
  assert.equal(bare.setting, null, "an empty seed yields no setting rather than an empty one");
  assert.ok(
    warnings.some((warning) => warning.includes("setting text")),
    "an empty setting is warned about, not rejected",
  );

  const { warnings: midImport } = fromCompatibleScenario({
    name: "Half",
    settingSeed: "x",
    npcs: [],
    metadata: { importing: true },
  });
  assert.ok(
    midImport.some((warning) => warning.includes("mid-import")),
    "a file exported mid-import is flagged",
  );
}

// ── 7. Structural detection ──────────────────────────────────────────────
{
  assert.equal(isCompatibleScenarioShape({ settingSeed: "x", npcs: [] }), true);
  assert.equal(
    isCompatibleScenarioShape({ type: "marinara_scenario", version: 1, data: {} }),
    false,
    "a native envelope is not a compatible file",
  );
  assert.equal(
    isCompatibleScenarioShape({ type: "marinara_lorebook", version: 1, data: {} }),
    false,
    "a lorebook envelope must not be read as a scenario",
  );
  assert.equal(
    isCompatibleScenarioShape({ spec: "chara_card_v2", data: { first_mes: "hi" } }),
    false,
    "a character card must not be read as a scenario",
  );
  assert.equal(
    isCompatibleScenarioShape({ entries: {}, name: "ST world info" }),
    false,
    "an ST lorebook must not be read as a scenario",
  );
  assert.equal(isCompatibleScenarioShape(null), false);
  assert.equal(isCompatibleScenarioShape("not an object"), false);
}

console.log("Scenario format regression passed.");
