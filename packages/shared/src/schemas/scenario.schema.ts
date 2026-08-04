// ──────────────────────────────────────────────
// Scenario Zod Schemas
// ──────────────────────────────────────────────
import { z } from "zod";

export const SCENARIO_SOURCE_VALUES = ["import", "wizard", "manual", "agent"] as const;
export type ScenarioSourceValue = (typeof SCENARIO_SOURCE_VALUES)[number];
export const scenarioSourceSchema = z.enum(SCENARIO_SOURCE_VALUES);

export const SCENARIO_CONTENT_RATING_VALUES = ["sfw", "nsfw"] as const;
export type ScenarioContentRatingValue = (typeof SCENARIO_CONTENT_RATING_VALUES)[number];
export const scenarioContentRatingSchema = z.enum(SCENARIO_CONTENT_RATING_VALUES);

/**
 * Coerce an unknown source to a valid one. Mirrors upstream's tolerance: an
 * unrecognised value degrades to `import` rather than failing the read.
 */
export function normalizeScenarioSource(value: unknown): ScenarioSourceValue {
  if (typeof value !== "string") return "import";
  const parsed = scenarioSourceSchema.safeParse(value.trim().toLowerCase());
  return parsed.success ? parsed.data : "import";
}

/** Coerce an unknown content rating. Anything unrecognised becomes `null` — never guess. */
export function normalizeScenarioContentRating(value: unknown): ScenarioContentRatingValue | null {
  if (typeof value !== "string") return null;
  const parsed = scenarioContentRatingSchema.safeParse(value.trim().toLowerCase());
  return parsed.success ? parsed.data : null;
}

export const scenarioKeyLocationSchema = z.object({
  name: z.string().default(""),
  description: z.string().default(""),
});

export const scenarioSettingSchema = z.object({
  name: z.string().default(""),
  description: z.string().default(""),
  keyLocations: z.array(scenarioKeyLocationSchema).default([]),
  atmosphere: z.string().default(""),
  themes: z.array(z.string()).default([]),
  potentialConflicts: z.array(z.string()).default([]),
});

export const generatedFieldProvenanceSchema = z.object({
  original: z.string(),
  at: z.string(),
  model: z.string().nullable().default(null),
  seed: z.string().nullable().default(null),
});

export const scenarioProtagonistSchema = z.object({
  name: z.string().default(""),
  description: z.string().default(""),
  backstory: z.string().default(""),
  motivation: z.string().default(""),
  traits: z.array(z.string()).default([]),
  appearance: z.string().nullable().default(null),
  characterId: z.string().nullable().default(null),
});

/** `id` is optional on input — storage mints one for any NPC that arrives without it. */
export const scenarioNpcSchema = z.object({
  id: z.string().optional(),
  name: z.string().default(""),
  role: z.string().default(""),
  description: z.string().default(""),
  relationship: z.string().default(""),
  traits: z.array(z.string()).default([]),
  characterId: z.string().nullable().default(null),
});

const scenarioBaseSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().default(""),
  imagePath: z.string().nullable().default(null),
  setting: scenarioSettingSchema.nullable().default(null),
  generated: z.record(z.string(), generatedFieldProvenanceSchema).nullable().default(null),
  protagonist: scenarioProtagonistSchema.nullable().default(null),
  npcs: z.array(scenarioNpcSchema).default([]),
  genre: z.string().nullable().default(null),
  contentRating: scenarioContentRatingSchema.nullable().default(null),
  firstMessage: z.string().nullable().default(null),
  alternateGreetings: z.array(z.string()).default([]),
  lorebookIds: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  favorite: z.boolean().default(false),
  source: scenarioSourceSchema.default("manual"),
  originalFilename: z.string().nullable().default(null),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const createScenarioSchema = scenarioBaseSchema;

/**
 * Every field optional. Note the storage layer distinguishes "key absent" from
 * "key present and null" for `setting` / `protagonist` / `generated`, so a save
 * that omits them leaves the stored value alone.
 */
export const updateScenarioSchema = scenarioBaseSchema.partial();

export type CreateScenarioInput = z.infer<typeof createScenarioSchema>;
export type UpdateScenarioInput = z.infer<typeof updateScenarioSchema>;
