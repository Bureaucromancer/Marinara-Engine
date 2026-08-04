import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { generateMissingConversationSummaries } from "../../packages/server/src/services/conversation/auto-summary.service.js";

const requestedMaxTokens: number[] = [];
const provider = {
  async chatComplete(_messages: unknown, options: { maxTokens?: number }) {
    requestedMaxTokens.push(options.maxTokens ?? 0);
    return {
      content: JSON.stringify({ summary: "A concise day summary.", keyDetails: ["A promise was made."] }),
      toolCalls: [],
      finishReason: "stop",
    };
  },
};

const result = await generateMissingConversationSummaries({
  messages: [
    {
      id: "message-1",
      role: "user",
      content: "I promise to call tomorrow.",
      createdAt: "2026-08-02T12:00:00.000Z",
    },
  ],
  metadata: {},
  provider: provider as never,
  model: "summary-model",
  personaName: "Mari",
  charIdToName: new Map(),
  now: new Date("2026-08-04T12:00:00.000Z"),
  timeZone: "Europe/Warsaw",
  timeoutMs: 50,
  maxTokens: 7777,
});

assert.ok(requestedMaxTokens.length > 0);
assert.equal(requestedMaxTokens.every((value) => value === 7777), true);
assert.equal(result.newlyGeneratedDays["02.08.2026"]?.summary, "A concise day summary.");

const chatsRouteSource = await readFile(
  new URL("../../packages/server/src/routes/chats.routes.ts", import.meta.url),
  "utf8",
);
assert.match(
  chatsRouteSource,
  /backfill-summaries[\s\S]*?resolveChatSummaryConnection\([\s\S]*?maxTokens: clampRoleplaySummaryMaxTokens/u,
  "Conversation backfills should use the selected summary connection and configured output budget",
);

process.stdout.write("Conversation summary regression passed.\n");
