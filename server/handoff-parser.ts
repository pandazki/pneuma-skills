/**
 * Shared handoff frontmatter parser.
 *
 * Originally backed three call sites under the v1 file-mediated handoff
 * protocol (skill-installer, handoff-watcher, projects-routes). The 2026-04-28
 * tool-call rewrite replaced the file-write path with `pneuma handoff` →
 * `/api/handoffs/emit` → in-memory proposal map → `inbound-handoff.json`,
 * so this module is no longer in any live request path.
 *
 * It's kept here as an audit helper: any remaining
 * `<projectRoot>/.pneuma/handoffs/*.md` files on disk from the v1 era can
 * still be inspected with these helpers (e.g. via a one-shot migration
 * script). Safe to delete once no v1 residue is observed in the wild.
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
