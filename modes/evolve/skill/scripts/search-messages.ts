#!/usr/bin/env bun
/**
 * search-messages.ts — Search across sessions for keyword matches in conversation text.
 *
 * Usage:
 *   bun search-messages.ts --query "prefer|always" [--since 2026-03-01] [--project <pattern>] [--role user|assistant|all] [--context 1] [--limit 50]
 *
 * Output: NDJSON with matching messages and optional surrounding context.
 */

import {
  listProjectDirs,
  listSessionFiles,
  decodeProjectName,
  streamJsonl,
  isUserTextMessage,
  extractAssistantText,
  parseCommonArgs,
} from "./_shared.ts";

const args = parseCommonArgs({
  query: { type: "string" },
  role: { type: "string" },
  context: { type: "string" },
});

if (!args.query) {
  console.error(
    "Usage: bun search-messages.ts --query <regex> [--since <date>] [--project <pattern>] [--role user|assistant|all] [--context N] [--limit N]"
  );
  process.exit(1);
}

const regex = new RegExp(args.query as string, "i");
const sinceDate = args.since ? new Date(args.since as string) : null;
const roleFilter = (args.role as string) ?? "all";
const contextN = args.context ? parseInt(args.context as string, 10) : 0;
const limit = args.limit ? parseInt(args.limit as string, 10) : 50;

interface TextMsg {
  role: string;
  timestamp: string;
  text: string;
}

async function main() {
  const projectDirs = await listProjectDirs(args.project as string | undefined);
  let matchCount = 0;

  for (const dir of projectDirs) {
    if (matchCount >= limit) break;
    const sessions = await listSessionFiles(dir);
    const projectName = decodeProjectName(dir);

    for (const session of sessions) {
      if (matchCount >= limit) break;
      if (sinceDate && session.mtime < sinceDate) continue;

      const textMessages: TextMsg[] = [];

      await streamJsonl(session.path, (obj) => {
        if (matchCount >= limit) return true;

        let role: string | null = null;
        let text: string | null = null;
        const timestamp = obj.timestamp;

        if (isUserTextMessage(obj)) {
          role = "user";
          text = obj.message.content;
        } else if (obj.type === "assistant") {
          const t = extractAssistantText(obj);
          if (t) {
            role = "assistant";
            text = t;
          }
        }

        if (role && text) {
          textMessages.push({ role, timestamp, text });

          if (roleFilter !== "all" && role !== roleFilter) return;
          if (!regex.test(text)) return;

          const idx = textMessages.length - 1;
          const contextBefore = contextN > 0
            ? textMessages.slice(Math.max(0, idx - contextN), idx).map(summarizeMsg)
            : undefined;

          const result: any = {
            session_id: obj.sessionId ?? session.file.replace(".jsonl", ""),
            project: projectName,
            timestamp,
            role,
            text: text.length > 500 ? text.substring(0, 500) + "..." : text,
          };
          if (contextBefore?.length) result.context_before = contextBefore;

          console.log(JSON.stringify(result));
          matchCount++;
        }
      });
    }
  }

  if (matchCount === 0) {
    console.error(`No matches found for "${args.query}"`);
  }
}

function summarizeMsg(msg: TextMsg): string {
  const preview = msg.text.length > 100 ? msg.text.substring(0, 100) + "..." : msg.text;
  return `[${msg.role}] ${preview}`;
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
