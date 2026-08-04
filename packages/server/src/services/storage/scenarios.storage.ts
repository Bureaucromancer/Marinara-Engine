// ──────────────────────────────────────────────
// Storage: Scenarios
// ──────────────────────────────────────────────
import { eq, desc, and, like, asc, or } from "../../db/file-query.js";
import type { DB } from "../../db/connection.js";
import { scenarios } from "../../db/schema/index.js";
import { newId, now } from "../../utils/id-generator.js";
import type {
  CreateScenarioInput,
  GeneratedFieldProvenance,
  Scenario,
  ScenarioNpc,
  ScenarioProtagonist,
  ScenarioSetting,
  UpdateScenarioInput,
} from "@marinara-engine/shared";
import { normalizeScenarioContentRating, normalizeScenarioSource } from "@marinara-engine/shared";
import { normalizeTimestampOverrides, type TimestampOverrides } from "../import/import-timestamps.js";
import { toPaginatedList } from "../../utils/list-pagination.js";

type ScenarioRow = typeof scenarios.$inferSelect;

export type ScenarioListPageOptions = {
  limit: number;
  offset: number;
  search?: string;
  sort?: string;
  /** "favorites" | "non-favorites"; anything else is a no-op. */
  favoriteFilter?: string;
};

function resolveTimestamps(overrides?: TimestampOverrides | null) {
  const normalized = normalizeTimestampOverrides(overrides);
  const createdAt = normalized?.createdAt ?? now();
  return { createdAt, updatedAt: normalized?.updatedAt ?? createdAt };
}

function likePattern(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? `%${trimmed}%` : "";
}

function scenarioOrder(sort: string | undefined) {
  switch (sort) {
    case "name-desc":
      return [desc(scenarios.name), asc(scenarios.id)];
    case "newest":
      return [desc(scenarios.createdAt), asc(scenarios.id)];
    case "oldest":
      return [asc(scenarios.createdAt), asc(scenarios.id)];
    case "favorites":
      return [desc(scenarios.favorite), asc(scenarios.name), asc(scenarios.id)];
    case "name-asc":
    default:
      return [asc(scenarios.name), asc(scenarios.id)];
  }
}

/** Parse defensively — a NULL or malformed JSON column degrades to an empty collection. */
function parseJsonArray<T>(value: unknown): T[] {
  if (typeof value !== "string" || value.trim().length === 0) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function parseJsonObject<T>(value: unknown): T | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as T) : null;
  } catch {
    return null;
  }
}

function parseScenarioRow(row: ScenarioRow): Scenario {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    imagePath: row.imagePath || null,
    setting: parseJsonObject<ScenarioSetting>(row.setting),
    generated: parseJsonObject<Record<string, GeneratedFieldProvenance>>(row.generated),
    protagonist: parseJsonObject<ScenarioProtagonist>(row.protagonist),
    npcs: parseJsonArray<ScenarioNpc>(row.npcs),
    genre: row.genre || null,
    contentRating: normalizeScenarioContentRating(row.contentRating),
    firstMessage: row.firstMessage ?? null,
    alternateGreetings: parseJsonArray<string>(row.alternateGreetings),
    lorebookIds: parseJsonArray<string>(row.lorebookIds),
    tags: parseJsonArray<string>(row.tags),
    favorite: row.favorite === "true",
    source: normalizeScenarioSource(row.source),
    originalFilename: row.originalFilename || null,
    metadata: parseJsonObject<Record<string, unknown>>(row.metadata) ?? {},
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Mint an id for any NPC that arrives without one, so cast members are addressable. */
function withNpcIds(npcs: CreateScenarioInput["npcs"]): ScenarioNpc[] {
  return (npcs ?? []).map((npc) => ({
    id: npc.id && npc.id.length > 0 ? npc.id : newId(),
    name: npc.name,
    role: npc.role,
    description: npc.description,
    relationship: npc.relationship,
    traits: npc.traits,
    characterId: npc.characterId,
  }));
}

export function createScenariosStorage(db: DB) {
  return {
    async list(): Promise<Scenario[]> {
      const rows = await db.select().from(scenarios).orderBy(desc(scenarios.updatedAt));
      return rows.map(parseScenarioRow);
    },

    async listPage(options: ScenarioListPageOptions) {
      const clauses = [];
      const pattern = likePattern(options.search);
      if (pattern) {
        clauses.push(
          or(
            like(scenarios.name, pattern),
            like(scenarios.description, pattern),
            like(scenarios.genre, pattern),
            like(scenarios.tags, pattern),
          ),
        );
      }
      // `favorite` is a real column here (unlike characters, where the flag
      // lives inside a JSON blob), so this stays a SQL-side filter with no
      // in-memory fallback path.
      if (options.favoriteFilter === "favorites") clauses.push(eq(scenarios.favorite, "true"));
      else if (options.favoriteFilter === "non-favorites") clauses.push(eq(scenarios.favorite, "false"));

      const whereClause = clauses.length > 0 ? and(...clauses) : undefined;
      const rows = await (whereClause
        ? db
            .select()
            .from(scenarios)
            .where(whereClause)
            .orderBy(...scenarioOrder(options.sort))
            .limit(options.limit + 1)
            .offset(options.offset)
        : db
            .select()
            .from(scenarios)
            .orderBy(...scenarioOrder(options.sort))
            .limit(options.limit + 1)
            .offset(options.offset));

      return {
        ...toPaginatedList(rows, options.limit, options.offset),
        items: rows.slice(0, options.limit).map(parseScenarioRow),
      };
    },

    async getById(id: string): Promise<Scenario | null> {
      const rows = await db.select().from(scenarios).where(eq(scenarios.id, id));
      return rows[0] ? parseScenarioRow(rows[0]) : null;
    },

    async create(input: CreateScenarioInput, timestampOverrides?: TimestampOverrides | null) {
      const id = newId();
      const timestamp = resolveTimestamps(timestampOverrides);
      await db.insert(scenarios).values({
        id,
        name: input.name,
        description: input.description ?? "",
        imagePath: input.imagePath ?? null,
        setting: input.setting ? JSON.stringify(input.setting) : null,
        generated: input.generated ? JSON.stringify(input.generated) : null,
        protagonist: input.protagonist ? JSON.stringify(input.protagonist) : null,
        npcs: JSON.stringify(withNpcIds(input.npcs)),
        genre: input.genre ?? null,
        contentRating: input.contentRating ?? null,
        firstMessage: input.firstMessage ?? null,
        alternateGreetings: JSON.stringify(input.alternateGreetings ?? []),
        lorebookIds: JSON.stringify(input.lorebookIds ?? []),
        tags: JSON.stringify(input.tags ?? []),
        favorite: String(input.favorite ?? false),
        source: input.source ?? "manual",
        originalFilename: input.originalFilename ?? null,
        metadata: JSON.stringify(input.metadata ?? {}),
        createdAt: timestamp.createdAt,
        updatedAt: timestamp.updatedAt,
      });
      return this.getById(id);
    },

    async update(id: string, input: UpdateScenarioInput) {
      const values: Record<string, unknown> = { updatedAt: now() };
      if (input.name !== undefined) values.name = input.name;
      if (input.description !== undefined) values.description = input.description;
      if (input.imagePath !== undefined) values.imagePath = input.imagePath;
      // `setting`, `protagonist` and `generated` are nullable objects, so a
      // caller must be able to clear them explicitly. Key-presence rather than
      // `!== undefined` on the value keeps "omitted" distinct from "set to
      // null" — this is what stops a partial save from wiping AI provenance
      // the editor never touched.
      if ("setting" in input) values.setting = input.setting ? JSON.stringify(input.setting) : null;
      if ("protagonist" in input) values.protagonist = input.protagonist ? JSON.stringify(input.protagonist) : null;
      if ("generated" in input) values.generated = input.generated ? JSON.stringify(input.generated) : null;
      if (input.npcs !== undefined) values.npcs = JSON.stringify(withNpcIds(input.npcs));
      if (input.genre !== undefined) values.genre = input.genre;
      if (input.contentRating !== undefined) values.contentRating = input.contentRating;
      if (input.firstMessage !== undefined) values.firstMessage = input.firstMessage;
      if (input.alternateGreetings !== undefined) {
        values.alternateGreetings = JSON.stringify(input.alternateGreetings);
      }
      if (input.lorebookIds !== undefined) values.lorebookIds = JSON.stringify(input.lorebookIds);
      if (input.tags !== undefined) values.tags = JSON.stringify(input.tags);
      if (input.favorite !== undefined) values.favorite = String(input.favorite);
      if (input.source !== undefined) values.source = input.source;
      if (input.originalFilename !== undefined) values.originalFilename = input.originalFilename;
      if (input.metadata !== undefined) values.metadata = JSON.stringify(input.metadata);

      await db.update(scenarios).set(values).where(eq(scenarios.id, id));
      return this.getById(id);
    },

    async remove(id: string) {
      await db.delete(scenarios).where(eq(scenarios.id, id));
    },

    /**
     * Server-side duplicate, matching the character convention (a POST
     * endpoint) rather than the lorebook one (rebuilt client-side), so npc id
     * minting and the favorite/originalFilename resets live in one place.
     */
    async duplicate(id: string) {
      const source = await this.getById(id);
      if (!source) return null;
      return this.create({
        name: `${source.name} (Copy)`,
        description: source.description,
        imagePath: source.imagePath,
        setting: source.setting,
        generated: source.generated,
        protagonist: source.protagonist,
        // Strip ids so the copy's cast members get fresh ones.
        npcs: source.npcs.map(({ id: _id, ...rest }) => rest),
        genre: source.genre,
        contentRating: source.contentRating,
        firstMessage: source.firstMessage,
        alternateGreetings: source.alternateGreetings,
        lorebookIds: source.lorebookIds,
        tags: source.tags,
        favorite: false,
        source: source.source,
        originalFilename: null,
        metadata: source.metadata,
      });
    },
  };
}
