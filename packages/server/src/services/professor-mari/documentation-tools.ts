import type { Dirent } from "node:fs";
import { lstat, readdir, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

const EXCLUDED_DOC_DIRS = new Set(["evidence", "pr-evidence", "screenshots", "examples", "i18n"]);
const MAX_DOC_FILE_BYTES = 1024 * 1024;
const DEFAULT_SEARCH_LIMIT = 5;
const MAX_SEARCH_LIMIT = 8;
const DEFAULT_READ_CHARS = 8_000;
const MAX_READ_CHARS = 16_000;
const MAX_EXCERPT_CHARS = 700;

interface DocumentationSection {
  path: string;
  heading: string;
  content: string;
  startLine: number;
}

export interface DocumentationSearchResult {
  path: string;
  heading: string;
  excerpt: string;
  startLine: number;
  score: number;
}

function normalizeDocPath(workspaceRoot: string, absolutePath: string) {
  return relative(workspaceRoot, absolutePath).split(sep).join("/");
}

async function collectMarkdownFiles(dir: string, workspaceRoot: string): Promise<string[]> {
  const files: string[] = [];
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DOC_DIRS.has(entry.name.toLowerCase())) continue;
      files.push(...(await collectMarkdownFiles(join(dir, entry.name), workspaceRoot)));
      continue;
    }
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;
    const absolutePath = join(dir, entry.name);
    if (normalizeDocPath(workspaceRoot, absolutePath).startsWith("docs/")) files.push(absolutePath);
  }
  return files;
}

async function canonicalDocumentationFiles(workspaceRoot: string): Promise<string[]> {
  const root = resolve(workspaceRoot);
  const files = await collectMarkdownFiles(join(root, "docs"), root);
  const readme = join(root, "README.md");
  try {
    if ((await lstat(readme)).isFile()) files.unshift(readme);
  } catch {
    // Packaged or partial workspaces may omit the root README while retaining docs/.
  }
  return files;
}

async function readBoundedMarkdown(filePath: string): Promise<string | null> {
  try {
    const info = await lstat(filePath);
    if (!info.isFile() || info.size > MAX_DOC_FILE_BYTES) return null;
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

function markdownSections(path: string, content: string): DocumentationSection[] {
  const lines = content.split(/\r?\n/);
  const headings = lines.flatMap((line, index) => {
    const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/u);
    return match ? [{ index, heading: match[2]!.trim() }] : [];
  });
  if (headings.length === 0) {
    return [{ path, heading: "Document overview", content, startLine: 1 }];
  }

  const sections: DocumentationSection[] = [];
  if (headings[0]!.index > 0) {
    sections.push({
      path,
      heading: "Document overview",
      content: lines.slice(0, headings[0]!.index).join("\n"),
      startLine: 1,
    });
  }
  headings.forEach((heading, index) => {
    const end = headings[index + 1]?.index ?? lines.length;
    sections.push({
      path,
      heading: heading.heading,
      content: lines.slice(heading.index + 1, end).join("\n"),
      startLine: heading.index + 1,
    });
  });
  return sections;
}

function readMarkdownHeading(path: string, content: string, requestedHeading: string): DocumentationSection | null {
  const lines = content.split(/\r?\n/);
  const normalizedHeading = requestedHeading.toLocaleLowerCase();
  for (const [index, line] of lines.entries()) {
    const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/u);
    if (!match || match[2]!.trim().toLocaleLowerCase() !== normalizedHeading) continue;
    const level = match[1]!.length;
    let end = lines.length;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const nextHeading = lines[cursor]!.match(/^(#{1,6})\s+/u);
      if (nextHeading && nextHeading[1]!.length <= level) {
        end = cursor;
        break;
      }
    }
    return {
      path,
      heading: match[2]!.trim(),
      content: lines.slice(index + 1, end).join("\n"),
      startLine: index + 1,
    };
  }
  return null;
}

function queryTerms(query: string) {
  return [...new Set(query.toLocaleLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu) ?? [])].filter(
    (term) => term.length > 1,
  );
}

function countOccurrences(text: string, needle: string) {
  if (!needle) return 0;
  let count = 0;
  let offset = 0;
  while ((offset = text.indexOf(needle, offset)) !== -1) {
    count += 1;
    offset += Math.max(needle.length, 1);
  }
  return count;
}

function sectionScore(section: DocumentationSection, phrase: string, terms: string[]) {
  const path = section.path.toLocaleLowerCase();
  const heading = section.heading.toLocaleLowerCase();
  const content = section.content.toLocaleLowerCase();
  let score = countOccurrences(content, phrase) * 12;
  if (heading.includes(phrase)) score += 30;
  if (path.includes(phrase)) score += 18;
  for (const term of terms) {
    score += Math.min(countOccurrences(content, term), 12);
    if (heading.includes(term)) score += 8;
    if (path.includes(term)) score += 5;
  }
  return score;
}

function excerptForMatch(content: string, phrase: string, terms: string[]) {
  const lines = content.split(/\r?\n/);
  const needles = [phrase, ...terms].filter(Boolean);
  const matchIndex = lines.findIndex((line) => {
    const normalized = line.toLocaleLowerCase();
    return needles.some((needle) => normalized.includes(needle));
  });
  const start = Math.max(0, matchIndex === -1 ? 0 : matchIndex - 1);
  const excerpt = lines
    .slice(start, start + 5)
    .join("\n")
    .trim();
  if (excerpt.length <= MAX_EXCERPT_CHARS) return excerpt;
  return `${excerpt.slice(0, MAX_EXCERPT_CHARS - 1).trimEnd()}…`;
}

export async function searchCanonicalDocumentation(
  workspaceRoot: string,
  query: string,
  requestedLimit = DEFAULT_SEARCH_LIMIT,
): Promise<DocumentationSearchResult[]> {
  const normalizedQuery = query.trim().slice(0, 200);
  if (normalizedQuery.length < 2) throw new Error("docs_search query must be at least 2 characters");
  const phrase = normalizedQuery.toLocaleLowerCase();
  const terms = queryTerms(normalizedQuery);
  const limit = Math.max(1, Math.min(MAX_SEARCH_LIMIT, Math.trunc(requestedLimit) || DEFAULT_SEARCH_LIMIT));
  const results: DocumentationSearchResult[] = [];

  for (const filePath of await canonicalDocumentationFiles(workspaceRoot)) {
    const content = await readBoundedMarkdown(filePath);
    if (content === null) continue;
    const path = normalizeDocPath(resolve(workspaceRoot), filePath);
    for (const section of markdownSections(path, content)) {
      const score = sectionScore(section, phrase, terms);
      if (score === 0) continue;
      results.push({
        path: section.path,
        heading: section.heading,
        excerpt: excerptForMatch(section.content, phrase, terms),
        startLine: section.startLine,
        score,
      });
    }
  }

  return results
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.startLine - b.startLine)
    .slice(0, limit);
}

function resolveCanonicalDocPath(workspaceRoot: string, requestedPath: string) {
  const normalized = requestedPath.trim().replace(/^\.\//u, "").replace(/\\/gu, "/");
  if (normalized !== "README.md" && (!normalized.startsWith("docs/") || !normalized.toLowerCase().endsWith(".md"))) {
    throw new Error("docs_read path must be README.md or an English Markdown file under docs/");
  }
  const segments = normalized.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("docs_read path is invalid");
  }
  if (segments[0] === "docs" && EXCLUDED_DOC_DIRS.has((segments[1] ?? "").toLowerCase())) {
    throw new Error("docs_read path is outside the canonical user documentation set");
  }
  return { normalized, absolute: resolve(workspaceRoot, ...segments) };
}

export async function readCanonicalDocumentation(
  workspaceRoot: string,
  requestedPath: string,
  requestedHeading?: string,
  requestedMaxChars = DEFAULT_READ_CHARS,
) {
  const { normalized, absolute } = resolveCanonicalDocPath(workspaceRoot, requestedPath);
  const content = await readBoundedMarkdown(absolute);
  if (content === null) throw new Error(`Documentation file not found or too large: ${normalized}`);
  const heading = requestedHeading?.trim();
  const section = heading ? readMarkdownHeading(normalized, content, heading) : null;
  if (heading && !section) throw new Error(`Heading not found in ${normalized}: ${heading}`);
  const selected = section?.content ?? content;
  const maxChars = Math.max(1_000, Math.min(MAX_READ_CHARS, Math.trunc(requestedMaxChars) || DEFAULT_READ_CHARS));
  const truncated = selected.length > maxChars;
  return {
    path: normalized,
    heading: section?.heading ?? markdownSections(normalized, content)[0]?.heading ?? "Document overview",
    startLine: section?.startLine ?? 1,
    content: truncated ? `${selected.slice(0, maxChars).trimEnd()}\n…` : selected,
    truncated,
  };
}

export function formatDocumentationSearch(query: string, results: DocumentationSearchResult[]) {
  if (results.length === 0) {
    return `No canonical documentation matches found for: ${query.trim()}`;
  }
  return [
    `Canonical documentation matches for: ${query.trim()}`,
    ...results.map(
      (result, index) =>
        `${index + 1}. Source: ${result.path} — Heading: ${result.heading} — Line: ${result.startLine}\n${result.excerpt}`,
    ),
  ].join("\n\n");
}

export function formatDocumentationRead(result: Awaited<ReturnType<typeof readCanonicalDocumentation>>) {
  return [
    `Source: ${result.path}`,
    `Heading: ${result.heading}`,
    `Starts at line: ${result.startLine}${result.truncated ? " (bounded excerpt)" : ""}`,
    "",
    result.content,
  ].join("\n");
}
