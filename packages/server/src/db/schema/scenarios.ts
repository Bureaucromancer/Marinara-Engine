// ──────────────────────────────────────────────
// Schema: Scenarios
//
// A reusable seed — setting, supporting cast and opening — decoupled from any
// individual chat. No child tables, so no CASCADES entry is needed.
//
// Every JSON-encoded column below must also be listed in JSON_COLUMNS in
// services/mari-db/mari-db.service.ts; that mapping cannot be derived
// automatically and is guarded by scripts/regressions/scenario-compat.regression.ts.
// ──────────────────────────────────────────────
import { fileTable, text } from "../file-schema.js";

export const scenarios = fileTable("scenarios", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  imagePath: text("image_path"),

  /** JSON ScenarioSetting object, or NULL when the setting has not been written yet. */
  setting: text("setting"),
  /** JSON map of dotted field path -> GeneratedFieldProvenance, or NULL when hand-authored. */
  generated: text("generated"),
  /** JSON ScenarioProtagonist object, or NULL (the normal state for 2nd-person scenarios). */
  protagonist: text("protagonist"),
  /** JSON array of ScenarioNpc. */
  npcs: text("npcs").notNull().default("[]"),

  /** Free text play hint consumed by game setup. */
  genre: text("genre"),
  /**
   * "sfw" | "nsfw" | NULL. Deliberately NOT declared with { enum }: every enum
   * column in this schema is .notNull(), and file-schema.ts takes the enum as
   * an ignored `_options` argument, so a nullable enum here would assert a
   * constraint nothing enforces. Validation lives in the Zod schema.
   */
  contentRating: text("content_rating"),

  firstMessage: text("first_message"),
  /** JSON array of strings. */
  alternateGreetings: text("alternate_greetings").notNull().default("[]"),
  /** JSON array of lorebook ids. Dangling ids are tolerated, not cleaned up. */
  lorebookIds: text("lorebook_ids").notNull().default("[]"),
  /** JSON array of strings. */
  tags: text("tags").notNull().default("[]"),

  favorite: text("favorite").notNull().default("false"),
  source: text("source", { enum: ["import", "wizard", "manual", "agent"] })
    .notNull()
    .default("manual"),
  originalFilename: text("original_filename"),
  /** JSON object. Open map — unrecognised keys are preserved on import. */
  metadata: text("metadata").notNull().default("{}"),

  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
