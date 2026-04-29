/**
 * Shared utilities for CC history analysis scripts.
 * All scripts use streaming JSONL processing to handle large files efficiently.
 *
 * Adapted from https://github.com/nanxingw/skill-evolver
 */

import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { homedir } from "node:os";
import { parseArgs } from "node:util";

export const PROJECTS_DIR = join(homedir(), ".claude", "projects");

/**
 * Decode a Claude project directory name back to a readable project name.
 * e.g. "-Users-alice-Desktop-my-project" → "my-project"
 */
export function decodeProjectName(dirName: string): string {
  const parts = dirName.split("-").filter(Boolean);
  if (parts.length <= 2) return parts.join("-");
  return parts.slice(-2).join("-");
}

interface JsonlHandler {
  (obj: any, rawLineLength: number): boolean | void;
}

/**
 * Stream-process a JSONL file line by line, calling handler for each parsed JSON object.
 * Handler receives (parsedObj, rawLineLength). Return `true` to stop early.
 */
export async function streamJsonl(filePath: string, handler: JsonlHandler): Promise<void> {
  const stream = createReadStream(filePath, { encoding: "utf-8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      const stop = handler(obj, line.length);
      if (stop === true) {
        rl.close();
        stream.destroy();
        return;
      }
    } catch {
      // skip unparseable lines
    }
  }
}

/**
 * Check if a message is a real user text message (not a tool_result).
 */
export function isUserTextMessage(obj: any): boolean {
  return (
    obj.type === "user" &&
    obj.message?.content &&
    typeof obj.message.content === "string"
  );
}

/**
 * Extract text blocks from an assistant message, returning concatenated text.
 * Returns null if no text blocks found.
 */
export function extractAssistantText(obj: any): string | null {
  if (obj.type !== "assistant") return null;
  const content = obj.message?.content;
  if (!Array.isArray(content)) return null;
  const texts = content
    .filter((b: any) => b.type === "text" && b.text)
    .map((b: any) => b.text);
  return texts.length > 0 ? texts.join("\n") : null;
}

/**
 * Extract tool_use blocks from an assistant message.
 */
export function extractToolUses(obj: any): any[] {
  if (obj.type !== "assistant") return [];
  const content = obj.message?.content;
  if (!Array.isArray(content)) return [];
  return content.filter((b: any) => b.type === "tool_use");
}

/**
 * Get a summary of a tool_use input (first meaningful field, truncated).
 */
export function summarizeToolInput(input: any, maxLen = 120): string {
  if (!input || typeof input !== "object") return "";
  const key =
    input.command ??
    input.file_path ??
    input.pattern ??
    input.query ??
    input.url ??
    input.prompt ??
    input.content;
  if (!key) {
    const firstVal = Object.values(input)[0];
    return typeof firstVal === "string" ? firstVal.substring(0, maxLen) : "";
  }
  return String(key).substring(0, maxLen);
}

/**
 * List all project directories under ~/.claude/projects/.
 */
export async function listProjectDirs(projectFilter?: string | null): Promise<string[]> {
  let dirs: string[];
  try {
    dirs = await readdir(PROJECTS_DIR);
  } catch {
    return [];
  }
  if (projectFilter) {
    const lower = projectFilter.toLowerCase();
    dirs = dirs.filter((d) => d.toLowerCase().includes(lower));
  }
  return dirs;
}

export interface SessionFileInfo {
  file: string;
  path: string;
  mtime: Date;
  size: number;
}

/**
 * List all JSONL session files in a project directory, sorted by mtime desc.
 */
export async function listSessionFiles(projectDir: string): Promise<SessionFileInfo[]> {
  const fullDir = join(PROJECTS_DIR, projectDir);
  let files: string[];
  try {
    files = await readdir(fullDir);
  } catch {
    return [];
  }
  const jsonlFiles = files.filter(
    (f) => f.endsWith(".jsonl") && !f.includes("/")
  );
  const withStats = await Promise.all(
    jsonlFiles.map(async (f): Promise<SessionFileInfo | null> => {
      const fullPath = join(fullDir, f);
      try {
        const s = await stat(fullPath);
        return { file: f, path: fullPath, mtime: s.mtime, size: s.size };
      } catch {
        return null;
      }
    })
  );
  return (withStats.filter(Boolean) as SessionFileInfo[])
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
}

/**
 * Parse common CLI arguments shared across scripts.
 */
export function parseCommonArgs(extraOptions: Record<string, any> = {}): Record<string, any> {
  const { values } = parseArgs({
    options: {
      since: { type: "string" },
      project: { type: "string" },
      limit: { type: "string" },
      file: { type: "string" },
      help: { type: "boolean", short: "h" },
      ...extraOptions,
    },
    allowPositionals: true,
    strict: false,
  });
  return values;
}
