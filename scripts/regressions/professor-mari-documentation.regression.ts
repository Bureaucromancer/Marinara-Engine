import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  formatDocumentationRead,
  formatDocumentationSearch,
  readCanonicalDocumentation,
  searchCanonicalDocumentation,
} from "../../packages/server/src/services/professor-mari/documentation-tools.js";
import { parseAssistantWorkspaceAction } from "../../packages/server/src/services/professor-mari/workspace-agent.service.js";

const workspaceRoot = await mkdtemp(join(tmpdir(), "marinara-doc-tools-"));

try {
  await mkdir(join(workspaceRoot, "docs", "connections"), { recursive: true });
  await mkdir(join(workspaceRoot, "docs", "examples"), { recursive: true });
  await writeFile(join(workspaceRoot, "README.md"), "# Marinara Engine\n\nInstall the engine with pnpm.\n", "utf8");
  await writeFile(
    join(workspaceRoot, "docs", "connections", "proxy.md"),
    [
      "# Provider connections",
      "",
      "## Proxy timeout",
      "",
      "Increase the proxy timeout when a local provider needs longer to answer.",
      "Keep the connection URL unchanged.",
      "",
      "### Windows launcher",
      "",
      "The packaged launcher uses the same timeout setting.",
      "",
      "## API keys",
      "",
      "Store keys in the connection editor.",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    join(workspaceRoot, "docs", "examples", "ignored.md"),
    "# Proxy timeout\n\nThis internal example must not be searched.",
    "utf8",
  );

  const results = await searchCanonicalDocumentation(workspaceRoot, "proxy timeout", 3);
  assert.equal(results[0]?.path, "docs/connections/proxy.md");
  assert.equal(results[0]?.heading, "Proxy timeout");
  assert.match(results[0]?.excerpt ?? "", /local provider/u);
  assert.ok(results.every((result) => !result.path.includes("examples")));

  const formattedSearch = formatDocumentationSearch("proxy timeout", results);
  assert.match(formattedSearch, /Source: docs\/connections\/proxy\.md/u);
  assert.match(formattedSearch, /Heading: Proxy timeout/u);

  const section = await readCanonicalDocumentation(workspaceRoot, "docs/connections/proxy.md", "Proxy timeout", 1_000);
  assert.match(section.content, /Increase the proxy timeout/u);
  assert.match(section.content, /packaged launcher/u);
  assert.doesNotMatch(section.content, /Store keys/u);
  assert.match(formatDocumentationRead(section), /Source: docs\/connections\/proxy\.md/u);

  const readmeResults = await searchCanonicalDocumentation(workspaceRoot, "install engine", 3);
  assert.equal(readmeResults[0]?.path, "README.md");

  await assert.rejects(() => readCanonicalDocumentation(workspaceRoot, "../outside.md"), /must be README\.md/u);
  await assert.rejects(
    () => readCanonicalDocumentation(workspaceRoot, "docs/connections/proxy.md", "Missing heading"),
    /Heading not found/u,
  );

  const jsonAction = parseAssistantWorkspaceAction(
    JSON.stringify({
      say: "",
      commands: [{ name: "docs_search", arguments: { query: "proxy timeout" } }],
      stop: false,
    }),
  );
  assert.equal(jsonAction.commands[0]?.name, "docs_search");
  assert.deepEqual(jsonAction.commands[0]?.arguments, { query: "proxy timeout" });

  const textualAction = parseAssistantWorkspaceAction(
    '<docs_read>{"path":"docs/connections/proxy.md","heading":"Proxy timeout"}</docs_read>',
  );
  assert.equal(textualAction.commands[0]?.name, "docs_read");
  assert.equal(textualAction.commands[0]?.arguments.heading, "Proxy timeout");

  console.log("Professor Mari documentation regression passed");
} finally {
  await rm(workspaceRoot, { recursive: true, force: true });
}
