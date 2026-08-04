// ──────────────────────────────────────────────
// Import: scenario link resolution
//
// A scenario references lorebooks and characters by plain id. Nothing is
// embedded in an export, so an id from another install usually will not exist
// locally. Both scenario importers resolve links through this one helper so
// the native and compatible lanes cannot drift apart.
//
// Resolution order per link: exact id, then exact name (case-insensitive),
// then drop and report. An unresolvable link NEVER fails an import — the
// scenario is still useful without it, and the editor renders the absence.
// ──────────────────────────────────────────────
import type { DB } from "../../db/connection.js";
import { createCharactersStorage } from "../storage/characters.storage.js";
import { createLorebooksStorage } from "../storage/lorebooks.storage.js";

export type DroppedScenarioLink = { kind: "lorebook" | "character"; ref: string };

export interface ScenarioLinkResolution {
  /** Old id -> resolved local id, for links that survived. */
  lorebookIds: Map<string, string>;
  characterIds: Map<string, string>;
  dropped: DroppedScenarioLink[];
}

function nameKey(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function parseCharacterName(data: unknown): string {
  if (typeof data !== "string") return "";
  try {
    const parsed = JSON.parse(data) as { name?: unknown };
    return typeof parsed.name === "string" ? parsed.name : "";
  } catch {
    return "";
  }
}

/**
 * Resolve exported lorebook and character ids against the local library.
 *
 * `names` optionally carries the exported entity's name alongside its id so a
 * name fallback is possible; native scenario exports do not carry linked names
 * today, so in practice the id match does the work and the name path is there
 * for files that grow richer link records later.
 */
export async function resolveScenarioLinks(
  db: DB,
  input: {
    lorebookIds?: string[];
    characterIds?: string[];
    lorebookNames?: Record<string, string>;
    characterNames?: Record<string, string>;
  },
): Promise<ScenarioLinkResolution> {
  const result: ScenarioLinkResolution = { lorebookIds: new Map(), characterIds: new Map(), dropped: [] };

  const wantedLorebookIds = Array.from(new Set((input.lorebookIds ?? []).filter((id) => typeof id === "string" && id)));
  const wantedCharacterIds = Array.from(
    new Set((input.characterIds ?? []).filter((id) => typeof id === "string" && id)),
  );
  if (wantedLorebookIds.length === 0 && wantedCharacterIds.length === 0) return result;

  if (wantedLorebookIds.length > 0) {
    const lorebooksStorage = createLorebooksStorage(db);
    // The hydrated row type is a wide projection; only id and name matter here.
    const all = (await lorebooksStorage.list()) as unknown as Array<{ id: string; name: string }>;
    const byId = new Set(all.map((book) => String(book.id)));
    const byName = new Map<string, string>();
    for (const book of all) {
      const key = nameKey(book.name);
      if (key && !byName.has(key)) byName.set(key, String(book.id));
    }
    for (const id of wantedLorebookIds) {
      if (byId.has(id)) {
        result.lorebookIds.set(id, id);
        continue;
      }
      const fallbackName = nameKey(input.lorebookNames?.[id]);
      const matched = fallbackName ? byName.get(fallbackName) : undefined;
      if (matched) result.lorebookIds.set(id, matched);
      else result.dropped.push({ kind: "lorebook", ref: input.lorebookNames?.[id] ?? id });
    }
  }

  if (wantedCharacterIds.length > 0) {
    const charactersStorage = createCharactersStorage(db);
    const all = await charactersStorage.list();
    const byId = new Set(all.map((character) => String(character.id)));
    const byName = new Map<string, string>();
    for (const character of all) {
      const key = nameKey(parseCharacterName((character as { data?: unknown }).data));
      if (key && !byName.has(key)) byName.set(key, String(character.id));
    }
    for (const id of wantedCharacterIds) {
      if (byId.has(id)) {
        result.characterIds.set(id, id);
        continue;
      }
      const fallbackName = nameKey(input.characterNames?.[id]);
      const matched = fallbackName ? byName.get(fallbackName) : undefined;
      if (matched) result.characterIds.set(id, matched);
      else result.dropped.push({ kind: "character", ref: input.characterNames?.[id] ?? id });
    }
  }

  return result;
}
