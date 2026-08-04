// ──────────────────────────────────────────────
// Scenario ↔ Compatible JSON conversion
//
// Deliberately dependency-free (no zod) so both the server importer and the
// client import modal can use it, and so the whole mapping is testable without
// a database. See scripts/regressions/scenario-compat.regression.ts.
// ──────────────────────────────────────────────
import type {
  CompatibleScenario,
  GeneratedFieldProvenance,
  Scenario,
  ScenarioContentRating,
  ScenarioNpc,
  ScenarioProtagonist,
  ScenarioSetting,
  ScenarioSource,
} from "../types/scenario.js";

/**
 * Counters upstream persists alongside the real fields. They duplicate
 * information already present and go stale, so they are recomputed on write
 * and never stored. See docs/scenarios/format-reference.md.
 */
export const DERIVED_SCENARIO_METADATA_KEYS = ["npcCount", "hasFirstMessage", "alternateGreetingsCount"] as const;

/** Key under which Marinara-only structure rides along in a compatible file. */
export const MARINARA_METADATA_KEY = "marinara";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Epoch milliseconds → ISO 8601. Invalid input degrades to "now" rather than throwing. */
export function epochMsToIso(value: unknown): string {
  const ms = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(ms)) return new Date().toISOString();
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

/** ISO 8601 → epoch milliseconds. Invalid input degrades to "now". */
export function isoToEpochMs(value: unknown): number {
  const parsed = Date.parse(asString(value));
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

/**
 * Remove the derived counters and the transient upstream import flag.
 * Everything else is preserved — the map is open upstream and a reader that
 * drops unknown keys breaks their round trip.
 */
export function stripDerivedScenarioMetadata(metadata: unknown): Record<string, unknown> {
  if (!isRecord(metadata)) return {};
  const next = { ...metadata };
  for (const key of DERIVED_SCENARIO_METADATA_KEYS) delete next[key];
  // Transient UI flag upstream, never persistent state.
  delete next.importing;
  return next;
}

/**
 * Structural detection. A compatible scenario has no envelope and no `type`
 * discriminator, so it can only be recognised by shape: a string `settingSeed`
 * beside an array `npcs`.
 */
export function isCompatibleScenarioShape(value: unknown): boolean {
  return isRecord(value) && typeof value.settingSeed === "string" && Array.isArray(value.npcs) && !("type" in value);
}

function emptySetting(): ScenarioSetting {
  return { name: "", description: "", keyLocations: [], atmosphere: "", themes: [], potentialConflicts: [] };
}

function readSettingStash(value: unknown): ScenarioSetting | null {
  if (!isRecord(value)) return null;
  return {
    name: asString(value.name),
    description: asString(value.description),
    keyLocations: Array.isArray(value.keyLocations)
      ? value.keyLocations.filter(isRecord).map((entry) => ({
          name: asString(entry.name),
          description: asString(entry.description),
        }))
      : [],
    atmosphere: asString(value.atmosphere),
    themes: asStringArray(value.themes),
    potentialConflicts: asStringArray(value.potentialConflicts),
  };
}

function readProtagonistStash(value: unknown): ScenarioProtagonist | null {
  if (!isRecord(value)) return null;
  return {
    name: asString(value.name),
    description: asString(value.description),
    backstory: asString(value.backstory),
    motivation: asString(value.motivation),
    traits: asStringArray(value.traits),
    appearance: asNullableString(value.appearance),
    characterId: asNullableString(value.characterId),
  };
}

function readGeneratedStash(value: unknown): Record<string, GeneratedFieldProvenance> | null {
  if (!isRecord(value)) return null;
  const out: Record<string, GeneratedFieldProvenance> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isRecord(entry) || typeof entry.original !== "string") continue;
    out[key] = {
      original: entry.original,
      at: asString(entry.at, new Date().toISOString()),
      model: asNullableString(entry.model),
      seed: asNullableString(entry.seed),
    };
  }
  return Object.keys(out).length > 0 ? out : null;
}

function readContentRating(value: unknown): ScenarioContentRating | null {
  return value === "sfw" || value === "nsfw" ? value : null;
}

/** Native → compatible. Lossy by design; Marinara-only structure is stashed under `metadata.marinara`. */
export function toCompatibleScenario(scenario: Scenario): CompatibleScenario {
  const metadata: Record<string, unknown> = {
    ...stripDerivedScenarioMetadata(scenario.metadata),
    // Recomputed, never trusted on read. Upstream uses these for cheap card
    // rendering without deserialising the payload.
    npcCount: scenario.npcs.length,
    hasFirstMessage: scenario.firstMessage !== null,
    alternateGreetingsCount: scenario.alternateGreetings.length,
  };

  // Only one lorebook is representable upstream; callers warn when there are more.
  if (scenario.lorebookIds.length > 0) metadata.linkedLorebookId = scenario.lorebookIds[0];

  const npcLinks: Record<string, string> = {};
  for (const npc of scenario.npcs) {
    if (npc.characterId) npcLinks[npc.name] = npc.characterId;
  }

  metadata[MARINARA_METADATA_KEY] = {
    setting: scenario.setting,
    protagonist: scenario.protagonist,
    generated: scenario.generated,
    genre: scenario.genre,
    contentRating: scenario.contentRating,
    // The flat `source` below cannot express "agent"; keep the true value here.
    source: scenario.source,
    ...(Object.keys(npcLinks).length > 0 ? { npcLinks } : {}),
    ...(scenario.lorebookIds.length > 1 ? { lorebookIds: scenario.lorebookIds } : {}),
  };

  return {
    id: scenario.id,
    name: scenario.name,
    description: scenario.description || null,
    settingSeed: scenario.setting?.description ?? "",
    npcs: scenario.npcs.map((npc) => ({
      name: npc.name,
      role: npc.role,
      description: npc.description,
      relationship: npc.relationship,
      traits: npc.traits,
    })),
    primaryCharacterName: scenario.protagonist?.name ?? "",
    firstMessage: scenario.firstMessage,
    alternateGreetings: scenario.alternateGreetings,
    tags: scenario.tags,
    favorite: scenario.favorite,
    // Upstream's enum has no "agent"; the true value rides in the stash above.
    source: scenario.source === "agent" ? "manual" : scenario.source,
    originalFilename: scenario.originalFilename,
    metadata,
    createdAt: isoToEpochMs(scenario.createdAt),
    updatedAt: isoToEpochMs(scenario.updatedAt),
  };
}

export interface CompatibleScenarioImportResult {
  scenario: {
    name: string;
    description: string;
    setting: ScenarioSetting | null;
    generated: Record<string, GeneratedFieldProvenance> | null;
    protagonist: ScenarioProtagonist | null;
    npcs: Array<Omit<ScenarioNpc, "id">>;
    genre: string | null;
    contentRating: ScenarioContentRating | null;
    firstMessage: string | null;
    alternateGreetings: string[];
    lorebookIds: string[];
    tags: string[];
    favorite: boolean;
    source: ScenarioSource;
    originalFilename: string | null;
    metadata: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
  };
  warnings: string[];
}

/**
 * Compatible → native.
 *
 * **The flat field always wins over the stash.** The stash is Marinara's own
 * annotation; the flat fields are what other tools read and write. If someone
 * round-tripped the file through the other app and rewrote the setting there,
 * honouring a stale stash would silently discard their work. The stash only
 * supplies fields that have no flat counterpart.
 *
 * The one documented exception is `source`: the flat enum cannot express
 * "agent", so it is lossy by construction and the stash is strictly more
 * precise. In practice importers force `source: "import"` anyway.
 */
export function fromCompatibleScenario(raw: unknown, originalFilename?: string | null): CompatibleScenarioImportResult {
  const warnings: string[] = [];
  const record = isRecord(raw) ? raw : {};
  const incomingMetadata = isRecord(record.metadata) ? record.metadata : {};
  const stash = isRecord(incomingMetadata[MARINARA_METADATA_KEY])
    ? (incomingMetadata[MARINARA_METADATA_KEY] as Record<string, unknown>)
    : {};

  if (incomingMetadata.importing === true) {
    warnings.push("File was exported mid-import and may be incomplete.");
  }

  // ── Setting: stash supplies the structure, the flat seed supplies the prose ──
  const settingSeed = asString(record.settingSeed);
  const stashedSetting = readSettingStash(stash.setting);
  let setting: ScenarioSetting | null = null;
  if (stashedSetting) {
    setting = { ...stashedSetting, description: settingSeed };
  } else if (settingSeed.length > 0) {
    setting = { ...emptySetting(), description: settingSeed };
  }
  if (!setting || setting.description.trim().length === 0) {
    warnings.push("Scenario has no setting text.");
  }

  // ── Protagonist: stash supplies the body, the flat name wins ──
  const primaryCharacterName = asString(record.primaryCharacterName);
  const stashedProtagonist = readProtagonistStash(stash.protagonist);
  let protagonist: ScenarioProtagonist | null = null;
  if (stashedProtagonist) {
    protagonist = {
      ...stashedProtagonist,
      ...(primaryCharacterName.length > 0 ? { name: primaryCharacterName } : {}),
    };
  } else if (primaryCharacterName.length > 0) {
    protagonist = {
      name: primaryCharacterName,
      description: "",
      backstory: "",
      motivation: "",
      traits: [],
      appearance: null,
      characterId: null,
    };
  }

  // ── NPCs: flat array is authoritative; the stash only re-attaches links, by name ──
  const npcLinks = isRecord(stash.npcLinks) ? stash.npcLinks : {};
  const linkByName = new Map<string, string>();
  for (const [name, id] of Object.entries(npcLinks)) {
    const key = name.trim().toLowerCase();
    if (typeof id === "string" && id.length > 0 && !linkByName.has(key)) linkByName.set(key, id);
  }
  const seenNpcNames = new Set<string>();
  const npcs = (Array.isArray(record.npcs) ? record.npcs : []).filter(isRecord).map((npc) => {
    const name = asString(npc.name);
    const key = name.trim().toLowerCase();
    if (seenNpcNames.has(key) && linkByName.has(key)) {
      warnings.push(`More than one NPC is named "${name}"; the character link was applied to the first only.`);
    }
    const characterId = seenNpcNames.has(key) ? null : (linkByName.get(key) ?? null);
    seenNpcNames.add(key);
    return {
      name,
      role: asString(npc.role),
      description: asString(npc.description),
      relationship: asString(npc.relationship),
      traits: asStringArray(npc.traits),
      characterId,
    };
  });

  // ── Lorebook links: prefer the multi-id stash, fall back to the single upstream id ──
  const stashedLorebookIds = asStringArray(stash.lorebookIds);
  const linkedLorebookId = asNullableString(incomingMetadata.linkedLorebookId);
  const lorebookIds =
    stashedLorebookIds.length > 0 ? stashedLorebookIds : linkedLorebookId ? [linkedLorebookId] : [];

  // ── Metadata: drop everything consumed above, preserve the rest verbatim ──
  const metadata = stripDerivedScenarioMetadata(incomingMetadata);
  delete metadata[MARINARA_METADATA_KEY];
  delete metadata.linkedLorebookId;

  const name = asString(record.name).trim();
  if (name.length === 0) warnings.push("Scenario has no name.");

  return {
    scenario: {
      name,
      description: asString(record.description),
      setting,
      generated: readGeneratedStash(stash.generated),
      protagonist,
      npcs,
      genre: asNullableString(stash.genre),
      contentRating: readContentRating(stash.contentRating),
      firstMessage: typeof record.firstMessage === "string" ? record.firstMessage : null,
      alternateGreetings: asStringArray(record.alternateGreetings),
      lorebookIds,
      tags: asStringArray(record.tags),
      favorite: record.favorite === true,
      source: "import",
      originalFilename: originalFilename ?? asNullableString(record.originalFilename),
      metadata,
      createdAt: epochMsToIso(record.createdAt),
      updatedAt: epochMsToIso(record.updatedAt),
    },
    warnings,
  };
}
