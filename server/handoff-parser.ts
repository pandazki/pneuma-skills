/**
 * Shared handoff frontmatter parser.
 *
 * The 3.0 project layer authors handoff files at
 * `<projectRoot>/.pneuma/handoffs/<id>.md`. Three call sites need to read
 * them: skill-installer (sync, on session start), handoff-watcher (async,
 * via chokidar), and projects-routes (async, on confirm). Before this
 * module they each carried a near-identical hand-rolled YAML reader.
 *
 * The parser supports flat scalar keys, single-level `  - ` indented
 * lists, and matching surrounding single/double quotes. It is deliberately
 * minimal — sufficient for the well-known schema authored by the
 * `pneuma-project` skill, with no full-YAML dependency.
 */

import { existsSync, readFileSync } from "node:fs";

/**
 * Frontmatter shape for a handoff `.md` file.
 *
 * Authored by the source session via the `pneuma-project` skill. All
 * fields except `handoff_id` and `target_mode` are advisory — consumers
 * should degrade gracefully when any are missing.
 */
export interface HandoffFrontmatter {
  handoff_id: string;
  target_mode: string;
  target_session?: string;
  source_session?: string;
  source_mode?: string;
  source_display_name?: string;
  intent?: string;
  suggested_files?: string[];
  created_at?: string;
}

/** A handoff file resolved from disk. `body` is the markdown after the closing `---`. */
export interface ParsedHandoff {
  path: string;
  frontmatter: HandoffFrontmatter;
  body: string;
}

/**
 * Parse a full handoff markdown document. Returns null when the document
 * has no frontmatter delimiter or when the required keys (`handoff_id`,
 * `target_mode`) are absent.
 */
export function parseHandoffMarkdown(path: string, raw: string): ParsedHandoff | null {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return null;
  const fm = parseFrontmatterBody(match[1]);
  if (!fm) return null;
  return { path, frontmatter: fm, body: match[2] };
}

/**
 * Parse just the frontmatter body (the text between the leading and
 * trailing `---` lines). Returns null when required keys are missing.
 */
export function parseFrontmatterBody(body: string): HandoffFrontmatter | null {
  const fm: Record<string, unknown> = {};
  let currentList: string[] | null = null;
  for (const line of body.split("\n")) {
    if (currentList && line.startsWith("  - ")) {
      currentList.push(line.slice(4).trim());
      continue;
    }
    currentList = null;
    const kv = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (!kv) continue;
    const [, k, v] = kv;
    if (v === "") {
      const list: string[] = [];
      fm[k] = list;
      currentList = list;
    } else {
      let value = v.trim();
      // Tolerate matching surrounding quotes (single or double) — common
      // YAML idiom; we do not interpret escapes within.
      if (
        (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
        (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
      ) {
        value = value.slice(1, -1);
      }
      fm[k] = value;
    }
  }
  if (typeof fm.handoff_id !== "string" || typeof fm.target_mode !== "string") {
    return null;
  }
  return fm as unknown as HandoffFrontmatter;
}

/**
 * Sync helper — read the file at `path` and parse. Returns null when the
 * file is missing, unreadable, or malformed. Used by `skill-installer`
 * during synchronous CLAUDE.md injection.
 */
export function readHandoffSync(path: string): ParsedHandoff | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    return parseHandoffMarkdown(path, raw);
  } catch {
    return null;
  }
}
