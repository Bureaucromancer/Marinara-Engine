// ──────────────────────────────────────────────
// Scenario Types
//
// A scenario is a *reusable seed* — a setting, a supporting cast, and an
// opening — decoupled from any individual chat, so the same premise can be
// started many times. It is deliberately NOT a save file and NOT a story.
//
// The format is a deliberate divergence from the SillyTavern-derived vault
// scenario shape used by Aventuras (see docs/scenarios/format-reference.md).
// The differences that matter:
//   - the setting is a structure, not a single overloaded string
//   - derived counters are never persisted
//   - lorebook links are a real array, not a single id buried in metadata
//   - the protagonist is an object, not a bare name
//   - NPCs may point at a real character record
//   - timestamps are ISO strings (Marinara convention), not epoch ms
// ──────────────────────────────────────────────

/** Where a scenario came from. `agent` has no upstream equivalent. */
export type ScenarioSource = "import" | "wizard" | "manual" | "agent";

/** Content rating hint consumed by game setup. `null` means unspecified — never assume. */
export type ScenarioContentRating = "sfw" | "nsfw";

/** A named place within the setting. */
export interface ScenarioKeyLocation {
  name: string;
  description: string;
}

/**
 * The authored setting. This is the primary content of a scenario and the
 * whole of it is hand-authorable — AI expansion is an opt-in assist layered on
 * top later, not the expected path, which is why this is `setting` rather than
 * `expandedSetting`.
 */
export interface ScenarioSetting {
  name: string;
  /** The prose world description. This is what downstream consumers inject. */
  description: string;
  keyLocations: ScenarioKeyLocation[];
  atmosphere: string;
  themes: string[];
  potentialConflicts: string[];
}

/**
 * Retained generated value for a single field, so an edit can be reverted and
 * the source disclosed.
 *
 * NOTHING WRITES THIS YET. Scenario generation arrives in a later change; the
 * field exists now so imported files carrying provenance from another install
 * survive a round trip. It must be preserved verbatim across an editor save —
 * see `ScenarioEditor` and the storage layer's `update`.
 *
 * Generalises the `artStylePrompt` / `generatedArtStylePrompt` pair that
 * `GameSetupConfig` already uses for the same purpose.
 */
export interface GeneratedFieldProvenance {
  /** The generated value. JSON-encoded for array/object fields. */
  original: string;
  /** ISO timestamp of the generation run. */
  at: string;
  model: string | null;
  /** The input the generation ran from. */
  seed: string | null;
}

/** The played character. Optional — `null` is normal for a 2nd-person scenario. */
export interface ScenarioProtagonist {
  name: string;
  description: string;
  /** Named to match `Persona.backstory` and `CharacterExtensions.backstory`. */
  backstory: string;
  motivation: string;
  traits: string[];
  appearance: string | null;
  /** Optional link to a real character record. Nothing dereferences it yet. */
  characterId: string | null;
}

/**
 * A cast member. The inline snapshot is authoritative; `characterId` is a
 * pointer nothing dereferences yet.
 */
export interface ScenarioNpc {
  /** Stable local id, minted on create/import. */
  id: string;
  name: string;
  /** Free text: "antagonist", "mentor", "shopkeeper", … */
  role: string;
  description: string;
  /** Free text relationship to the protagonist. */
  relationship: string;
  traits: string[];
  characterId: string | null;
}

/** A complete scenario, as stored. */
export interface Scenario {
  id: string;
  /** Required, non-empty after trim. The only hard requirement in the format. */
  name: string;
  /** Short preview shown on library cards. Not injected anywhere. */
  description: string;
  /** Optional card art, parity with lorebooks. */
  imagePath: string | null;

  setting: ScenarioSetting | null;
  /** Per-field generation provenance keyed by dotted path (`"setting.themes"`). */
  generated: Record<string, GeneratedFieldProvenance> | null;

  protagonist: ScenarioProtagonist | null;
  npcs: ScenarioNpc[];

  /** Free text, maps to `GameSetupConfig.genre`. */
  genre: string | null;
  /** Maps to `GameSetupConfig.rating`. `null` = unspecified, so a consumer prompts. */
  contentRating: ScenarioContentRating | null;

  /** Opening narrative text. `null` means the story opens with a generated scene. */
  firstMessage: string | null;
  /** Anonymous alternatives to `firstMessage`. */
  alternateGreetings: string[];

  /** Linked lorebooks. Dangling ids are tolerated and shown as "missing" in the editor. */
  lorebookIds: string[];

  tags: string[];
  favorite: boolean;
  source: ScenarioSource;
  originalFilename: string | null;
  /** Open map — unrecognised keys are preserved rather than dropped. */
  metadata: Record<string, unknown>;

  /** ISO 8601. NOT epoch ms — conversion happens only at the compatible boundary. */
  createdAt: string;
  updatedAt: string;
}

/**
 * Wire shape for a native export. `formatVersion` is synthesized at export and
 * stripped at import; there is deliberately no column for it, because
 * persisting it would mean every row carries a constant only the export path
 * can meaningfully change.
 */
export type ExportedScenario = Scenario & { formatVersion: 1 };

/**
 * The Aventuras-shaped bare object emitted by the Compatible JSON lane.
 * Field names and types match `VaultScenario` upstream exactly, including the
 * epoch-millisecond timestamps and the persisted derived counters.
 */
export interface CompatibleScenario {
  id: string;
  name: string;
  description: string | null;
  settingSeed: string;
  npcs: Array<{
    name: string;
    role: string;
    description: string;
    relationship: string;
    traits: string[];
  }>;
  primaryCharacterName: string;
  firstMessage: string | null;
  alternateGreetings: string[];
  tags: string[];
  favorite: boolean;
  source: "import" | "wizard" | "manual";
  originalFilename: string | null;
  metadata: Record<string, unknown> | null;
  /** Epoch milliseconds, integer. */
  createdAt: number;
  updatedAt: number;
}
