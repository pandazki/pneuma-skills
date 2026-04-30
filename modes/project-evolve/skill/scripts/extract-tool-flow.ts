#!/usr/bin/env bun
/**
 * extract-tool-flow.ts — Extract tool usage sequence from a session.
 * Shows what tools were called, with brief input summaries and error detection.
 *
 * Usage:
 *   bun extract-tool-flow.ts --file <path.jsonl> [--compact]
 *
 * Output: NDJSON with {timestamp, tool, input_summary, success, error_hint?} per tool call.
 * --compact: outputs a single-line tool sequence like "Bash→Read→Edit→Bash(err)→Bash"
 */

import {
  streamJsonl,
  extractToolUses,
  summarizeToolInput,
  parseCommonArgs,
} from "./_shared.ts";

const args = parseCommonArgs({ compact: { type: "boolean" } });

if (!args.file) {
  console.error("Usage: bun extract-tool-flow.ts --file <path.jsonl> [--compact]");
  process.exit(1);
}

const ERROR_PATTERNS = /error|Error|ENOENT|EPERM|EACCES|failed|Failed|FAIL|exception|Exception|not found|No such file|Permission denied|panic|abort|Cannot find|Module not found|SyntaxError|TypeError|ReferenceError/;

interface ToolEntry {
  timestamp: string;
  tool: string;
  input_summary: string;
  success?: boolean;
  error_hint?: string;
}

async function main() {
  const pendingTools = new Map<string, ToolEntry>();
  const results: ToolEntry[] = [];

  await streamJsonl(args.file as string, (obj) => {
    if (obj.type === "assistant") {
      const toolUses = extractToolUses(obj);
      for (const tu of toolUses) {
        pendingTools.set(tu.id, {
          timestamp: obj.timestamp,
          tool: tu.name,
          input_summary: summarizeToolInput(tu.input),
        });
      }
    }

    if (obj.type === "user" && Array.isArray(obj.message?.content)) {
      for (const item of obj.message.content) {
        if (item.type === "tool_result" && item.tool_use_id) {
          const pending = pendingTools.get(item.tool_use_id);
          if (pending) {
            const resultContent = extractResultText(item.content);
            const hasError = ERROR_PATTERNS.test(resultContent);
            const entry: ToolEntry = { ...pending, success: !hasError };
            if (hasError) {
              entry.error_hint = extractErrorHint(resultContent);
            }
            results.push(entry);
            pendingTools.delete(item.tool_use_id);
          }
        }
      }
    }
  });

  for (const [, pending] of pendingTools) {
    results.push({ ...pending, success: true });
  }

  if (args.compact) {
    const sequence = results.map(
      (r) => r.success ? r.tool : `${r.tool}(err)`
    );
    console.log(sequence.join("→"));
  } else {
    for (const r of results) {
      console.log(JSON.stringify(r));
    }
  }
}

function extractResultText(content: any): string {
  if (typeof content === "string") return content.substring(0, 500);
  if (Array.isArray(content)) {
    return content
      .map((c: any) => {
        if (typeof c === "string") return c;
        if (c.type === "text") return c.text ?? "";
        return "";
      })
      .join("\n")
      .substring(0, 500);
  }
  return "";
}

function extractErrorHint(text: string): string {
  const lines = text.split("\n");
  for (const line of lines) {
    if (ERROR_PATTERNS.test(line)) {
      return line.trim().substring(0, 150);
    }
  }
  return text.substring(0, 150);
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
