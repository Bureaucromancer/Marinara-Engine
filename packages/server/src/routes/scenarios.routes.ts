// ──────────────────────────────────────────────
// Routes: Scenarios
// ──────────────────────────────────────────────
import type { FastifyInstance } from "fastify";
import { existsSync } from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import { extname, join } from "path";
import { createScenarioSchema, updateScenarioSchema } from "@marinara-engine/shared";
import { createScenariosStorage } from "../services/storage/scenarios.storage.js";
import {
  buildCompatibleScenarioExport,
  buildNativeScenarioEnvelope,
} from "../services/export/scenario-export.js";
import { normalizeTimestampOverrides } from "../services/import/import-timestamps.js";
import { DATA_DIR } from "../utils/data-dir.js";
import { assertInsideDir, extensionFromImageMime, isAllowedImageBuffer } from "../utils/security.js";
import { parseLibraryPageQuery } from "../utils/list-pagination.js";
import AdmZip from "adm-zip";

const SCENARIO_IMAGES_DIR = join(DATA_DIR, "scenarios", "images");

type ExportFormat = "native" | "compatible";

function toSafeExportName(name: string, fallback: string) {
  const sanitized = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return sanitized || fallback;
}

function resolveExportFormat(query: unknown, fallback: ExportFormat = "native"): ExportFormat {
  const raw = query && typeof query === "object" ? (query as Record<string, unknown>).format : undefined;
  return raw === "compatible" ? "compatible" : fallback;
}

function parseImageUpload(image: string): { buffer: Buffer; hintedExt: string } {
  let base64 = image;
  let hintedExt = "png";
  if (base64.startsWith("data:")) {
    const match = base64.match(/^data:image\/([\w.+-]+);base64,/i);
    if (match?.[1]) {
      hintedExt = match[1].replace("+xml", "");
      base64 = base64.slice(base64.indexOf(",") + 1);
    }
  }
  return { buffer: Buffer.from(base64, "base64"), hintedExt };
}

function getSafeScenarioImagePath(filename: string): string | null {
  if (!filename || filename.includes("..") || filename.includes("/") || filename.includes("\\")) return null;
  try {
    return assertInsideDir(SCENARIO_IMAGES_DIR, join(SCENARIO_IMAGES_DIR, filename));
  } catch {
    return null;
  }
}

export async function scenariosRoutes(app: FastifyInstance) {
  const storage = createScenariosStorage(app.db);

  app.get("/", async (req) => {
    const query = req.query as Record<string, string>;
    const page = parseLibraryPageQuery(query);
    if (page.hasPaging) {
      return storage.listPage({
        limit: page.limit,
        offset: page.offset,
        search: page.search,
        sort: page.sort,
        favoriteFilter: page.favoriteFilter,
      });
    }
    return storage.list();
  });

  // Registered before "/:id" so image requests are not swallowed by the id param.
  app.get<{ Params: { filename: string } }>("/images/file/:filename", async (req, reply) => {
    const filepath = getSafeScenarioImagePath(req.params.filename);
    if (!filepath || !existsSync(filepath)) return reply.status(404).send({ error: "Image not found" });

    const buffer = await readFile(filepath);
    const imageInfo = isAllowedImageBuffer(buffer, extname(req.params.filename));
    if (!imageInfo) return reply.status(404).send({ error: "Image not found" });

    return reply
      .header("Content-Type", imageInfo.mimeType)
      .header("Cache-Control", "public, max-age=31536000, immutable")
      .send(buffer);
  });

  app.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const scenario = await storage.getById(req.params.id);
    if (!scenario) return reply.status(404).send({ error: "Scenario not found" });
    return scenario;
  });

  app.post("/", async (req) => {
    const input = createScenarioSchema.parse(req.body);
    const body = req.body as Record<string, unknown>;
    return storage.create(
      input,
      normalizeTimestampOverrides({ createdAt: body.createdAt, updatedAt: body.updatedAt }),
    );
  });

  app.patch<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const input = updateScenarioSchema.parse(req.body);
    const updated = await storage.update(req.params.id, input);
    if (!updated) return reply.status(404).send({ error: "Scenario not found" });
    return updated;
  });

  app.post<{ Params: { id: string } }>("/:id/duplicate", async (req, reply) => {
    const result = await storage.duplicate(req.params.id);
    if (!result) return reply.status(404).send({ error: "Scenario not found" });
    return result;
  });

  app.post<{ Params: { id: string } }>("/:id/image", async (req, reply) => {
    const scenario = await storage.getById(req.params.id);
    if (!scenario) return reply.status(404).send({ error: "Scenario not found" });

    const body = req.body as { image?: string };
    if (!body.image) return reply.status(400).send({ error: "No image data provided" });

    const { buffer, hintedExt } = parseImageUpload(body.image);
    const imageInfo = isAllowedImageBuffer(buffer, `.${hintedExt}`);
    if (!imageInfo) return reply.status(400).send({ error: "Unsupported or invalid scenario image" });

    const ext = extensionFromImageMime(imageInfo.mimeType);
    await mkdir(SCENARIO_IMAGES_DIR, { recursive: true });
    const filename = `scenario-${req.params.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const filepath = assertInsideDir(SCENARIO_IMAGES_DIR, join(SCENARIO_IMAGES_DIR, filename));
    await writeFile(filepath, buffer);

    const updated = await storage.update(req.params.id, { imagePath: `/api/scenarios/images/file/${filename}` });
    if (!updated) return reply.status(404).send({ error: "Scenario not found" });
    return updated;
  });

  // No cascade cleanup: scenarios have no child tables and nothing references
  // them yet. Lorebook/character links are held as plain ids and dangling ones
  // are tolerated by design (the editor renders them as "missing").
  app.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    await storage.remove(req.params.id);
    return reply.status(204).send();
  });

  // ── Export ──
  //
  // Linked lorebooks and characters travel as plain ids in both lanes; nothing
  // is embedded, so links only resolve on an install that already has them.
  // The client warns before exporting a scenario that has any.

  app.get<{ Params: { id: string }; Querystring: { format?: ExportFormat } }>("/:id/export", async (req, reply) => {
    const scenario = await storage.getById(req.params.id);
    if (!scenario) return reply.status(404).send({ error: "Scenario not found" });

    const format = resolveExportFormat(req.query);
    const filename = encodeURIComponent(scenario.name || "scenario");
    if (format === "compatible") {
      return reply
        .header("Content-Disposition", `attachment; filename="${filename}.json"`)
        .send(buildCompatibleScenarioExport(scenario));
    }
    return reply
      .header("Content-Disposition", `attachment; filename="${filename}.marinara.json"`)
      .send(buildNativeScenarioEnvelope(scenario));
  });

  app.post("/export-bulk", async (req, reply) => {
    const { ids, format = "native" } = req.body as { ids?: string[]; format?: ExportFormat };
    if (!Array.isArray(ids) || ids.length === 0) {
      return reply.status(400).send({ error: "ids array is required" });
    }

    const zip = new AdmZip();
    let exportedCount = 0;
    for (const id of ids) {
      const scenario = await storage.getById(id);
      if (!scenario) continue;
      const safeName = toSafeExportName(scenario.name || "scenario", `scenario-${exportedCount + 1}`);
      const payload =
        format === "compatible" ? buildCompatibleScenarioExport(scenario) : buildNativeScenarioEnvelope(scenario);
      const extension = format === "compatible" ? "json" : "marinara.json";
      zip.addFile(`${safeName}.${extension}`, Buffer.from(JSON.stringify(payload, null, 2), "utf-8"));
      exportedCount++;
    }

    if (exportedCount === 0) {
      return reply.status(404).send({ error: "No scenarios found for the provided ids" });
    }

    return reply
      .header("Content-Type", "application/zip")
      .header(
        "Content-Disposition",
        `attachment; filename="${format === "compatible" ? "compatible-scenarios.zip" : "marinara-scenarios.zip"}"`,
      )
      .send(zip.toBuffer());
  });
}
