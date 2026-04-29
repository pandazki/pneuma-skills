#!/usr/bin/env bun
/**
 * session-digest.ts — Extract conversation essence from a session.
 * Outputs only user text messages and assistant text responses.
 * Filters out tool_results, progress, thinking, file-history-snapshots.
 *
 * This is the KEY noise-reduction tool: a 224MB JSONL → ~500KB of pure conversation.
 *
 * Usage:
 *   bun session-digest.ts --file <path.jsonl> [--max-turns 50]
 *
 * Output: NDJSON with {role, timestamp, text} per line.
 */

import {
  streamJsonl,
  isUserTextMessage,
  extractAssistantText,
  parseCommonArgs,
} from "./_shared.ts";

const args = parseCommonArgs({ "max-turns": { type: "string" } });

if (!args.file) {
  console.error("Usage: bun session-digest.ts --file <path.jsonl> [--max-turns 50]");
  process.exit(1);
}

const maxTurns = args["max-turns"] ? parseInt(args["max-turns"] as string, 10) : 0;

interface Entry {
  role: string;
  timestamp: string;
  text: string;
}

async function main() {
  let turnCount = 0;

  // Buffer assistant text blocks by message ID (they come in multiple JSONL lines)
  const assistantBuffer = new Map<string, { timestamp: string; texts: string[] }>();
  const entries: Entry[] = [];

  await streamJsonl(args.file as string, (obj) => {
    if (maxTurns > 0 && turnCount >= maxTurns) return true;

    if (isUserTextMessage(obj)) {
      flushAssistantBuffer(assistantBuffer, entries);
      entries.push({
        role: "user",
        timestamp: obj.timestamp,
        text: obj.message.content,
      });
      turnCount++;
    } else if (obj.type === "assistant") {
      const msgId = obj.message?.id;
      const text = extractAssistantText(obj);
      if (text && msgId) {
        if (!assistantBuffer.has(msgId)) {
          assistantBuffer.set(msgId, { timestamp: obj.timestamp, texts: [] });
        }
        assistantBuffer.get(msgId)!.texts.push(text);
      }
    }
  });

  flushAssistantBuffer(assistantBuffer, entries);

  for (const entry of entries) {
    console.log(JSON.stringify(entry));
  }
}

function flushAssistantBuffer(
  buffer: Map<string, { timestamp: string; texts: string[] }>,
  entries: Entry[],
) {
  for (const [, data] of buffer) {
    const combined = data.texts.join("\n");
    if (combined.trim()) {
      entries.push({ role: "assistant", timestamp: data.timestamp, text: combined });
    }
  }
  buffer.clear();
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
