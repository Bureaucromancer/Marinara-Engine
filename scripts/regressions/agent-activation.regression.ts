import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { matchCustomAgentActivation } from "../../packages/server/src/routes/generate/agent-activation.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const beforeResponse = [{ content: "Please continue normally." }];
const afterResponse = [...beforeResponse, { content: "The assistant mentions cobalt." }];

assert.equal(
  matchCustomAgentActivation({ activationKeywords: ["cobalt"], activationScanDepth: 1 }, beforeResponse).matched,
  false,
);
assert.equal(
  matchCustomAgentActivation({ activationKeywords: ["cobalt"], activationScanDepth: 1 }, afterResponse).matched,
  true,
  "Scan depth 1 must inspect the newly completed assistant response for post-processing agents",
);
assert.equal(
  matchCustomAgentActivation({ activationKeywords: ["continue"], activationScanDepth: 2 }, afterResponse).matched,
  true,
  "Larger scan depths must retain the preceding user message",
);

const generateRouteSource = readFileSync(join(repositoryRoot, "packages/server/src/routes/generate.routes.ts"), "utf8");
assert.match(
  generateRouteSource,
  /if \(agent\.phase !== "post_processing"\)[\s\S]{0,240}matchCustomAgentActivation\(agent\.settings, chatMessages\)/u,
  "Post-processing activation must not be decided before the assistant response exists",
);
assert.match(
  generateRouteSource,
  /const postActivationMessages = \[\.\.\.chatMessages, \{ content: combinedResponse \}\][\s\S]{0,600}matchCustomAgentActivation\(agent\.settings, postActivationMessages\)/u,
  "Post-processing activation must include the completed assistant response",
);
assert.match(
  generateRouteSource,
  /const activatedTextRewriteRunAgents = textRewriteRunAgents\.filter/u,
  "Text-rewrite agents must honor the same completed-response activation check",
);

console.info("Agent activation regression passed.");
