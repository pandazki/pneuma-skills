/**
 * Session environment resolution, shared by every wordtaste script.
 *
 * Ports the bash-era `openrouter_env.sh` + `primer_env.sh` (minus the PRNG, which lives in
 * `sampling.ts`). One resolution, used by the probe, the router, and the
 * composers alike, so the route that was tested is the route that runs.
 *
 * The `.env` files are parsed, never executed: they live in the workspace, and
 * evaluating one would run whatever it contains. No function here ever prints
 * key material — a value on stdout is one careless redirection away from a log.
 */

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";

/** The directory holding the entry scripts (`scripts/`). */
export const scriptsDir = join(import.meta.dir, "..");

/** The model the hosted writer route runs on when nobody names another one. */
export const WRITER_MODEL_DEFAULT = "anthropic/claude-sonnet-5";

/** Byte-order comparison, the `LC_ALL=C sort` the bash scripts relied on. */
export function byteCompare(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a), Buffer.from(b));
}

function fileNonEmpty(path: string): boolean {
  try {
    return statSync(path).isFile() && statSync(path).size > 0;
  } catch {
    return false;
  }
}

/**
 * One `KEY=value` line out of a `.env` file, quotes stripped, comments and
 * blank lines skipped. Returns null when the file has no non-empty value for
 * the key.
 */
export function envFileValue(file: string, want: string): string | null {
  if (!fileNonEmpty(file)) return null;
  const text = readFileSync(file, "utf8");
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/^[ \t\r\n]+/, "");
    if (line.length === 0 || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).replace(/[ \t\r\n]+$/, "");
    let value = line.slice(eq + 1).replace(/^[ \t\r\n]+/, "").replace(/[ \t\r\n]+$/, "");
    if (key !== want) continue;
    if (value.length >= 2) {
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
    }
    if (value.length > 0) return value;
  }
  return null;
}

/**
 * The OpenRouter key, or null when none is reachable. The environment wins,
 * then the `.env` the skill installer generates beside the installed skill,
 * then the session's own `.env`. Deliberately no walk up from the working
 * directory: a `.env` out of an arbitrary ancestor is a key of unknown
 * provenance.
 */
export function loadOpenRouterKey(sessionRoot: string): string | null {
  const fromEnv = process.env.OPENROUTER_API_KEY;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  for (const candidate of [join(scriptsDir, "..", ".env"), join(sessionRoot, ".env")]) {
    const value = envFileValue(candidate, "OPENROUTER_API_KEY");
    if (value !== null) return value;
  }
  return null;
}

function configValue(sessionRoot: string, key: string): string | null {
  for (const candidate of [join(sessionRoot, "config.json"), join(sessionRoot, ".pneuma", "config.json")]) {
    if (!existsSync(candidate)) continue;
    try {
      const parsed = JSON.parse(readFileSync(candidate, "utf8")) as Record<string, unknown>;
      const value = parsed[key];
      if (typeof value === "string" && value.length > 0 && value !== "null") return value;
      if (typeof value === "number") return String(value);
    } catch {
      // An unreadable config file answers nothing, exactly as `jq ... || true` did.
    }
  }
  return null;
}

/**
 * The model id for the hosted writer route. `WORDTASTE_WRITER_MODEL` wins,
 * then the `writerModel` init parameter through the same config.json chain as
 * `primerLibraries`, then the shipped default.
 */
export function writerModel(sessionRoot: string): string {
  const fromEnv = process.env.WORDTASTE_WRITER_MODEL;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return configValue(sessionRoot, "writerModel") ?? WRITER_MODEL_DEFAULT;
}

/** The `primerLibraries` init parameter, or `all` when the session never chose. */
export function primerSelection(sessionRoot: string): string {
  return configValue(sessionRoot, "primerLibraries") ?? "all";
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * A colon-separated library list for the primer sampler. The bundled
 * public-domain directory always leads; user libraries resolve against the
 * home root and, for a project session, the project root. A library is named,
 * never addressed: anything path-shaped is dropped so a config value cannot
 * walk out of the two primer roots.
 */
export function primerLibs(sessionRoot: string): string {
  const bundled = join(scriptsDir, "..", "references", "primer");
  const override = process.env.WORDTASTE_PRIMER_LIBS;
  if (override && override.length > 0) return override;

  const selection = primerSelection(sessionRoot);
  let libs = bundled;
  if (selection === "bundled") return libs;

  const roots: string[] = [];
  if (process.env.HOME && process.env.HOME.length > 0) {
    roots.push(join(process.env.HOME, ".pneuma", "primers"));
  }
  if (process.env.PNEUMA_PROJECT_ROOT && process.env.PNEUMA_PROJECT_ROOT.length > 0) {
    roots.push(join(process.env.PNEUMA_PROJECT_ROOT, ".pneuma", "primers"));
  }
  if (roots.length === 0) return libs;

  if (selection === "all") {
    for (const root of roots) {
      if (!isDir(root)) continue;
      const subdirs = readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(root, entry.name))
        .sort(byteCompare);
      for (const found of subdirs) libs = `${libs}:${found}`;
    }
    return libs;
  }

  for (const rawName of selection.split(",")) {
    const name = rawName.replace(/\s+/g, "");
    if (name.length === 0 || name.includes("/") || name === "." || name === "..") continue;
    for (const root of roots) {
      if (isDir(join(root, name))) libs = `${libs}:${join(root, name)}`;
    }
  }
  return libs;
}

/**
 * taskId + scope + repair count: the writer and the repairer of one passage
 * read different passages, and a resumed call reads the same ones.
 */
export function primerSeed(sessionRoot: string, scopePart: string, repairs: number | string = 0): string {
  let taskId = "";
  const workflowFile = join(sessionRoot, "workflow.json");
  if (existsSync(workflowFile)) {
    try {
      const parsed = JSON.parse(readFileSync(workflowFile, "utf8")) as Record<string, unknown>;
      if (typeof parsed.taskId === "string" && parsed.taskId !== "null") taskId = parsed.taskId;
      else if (typeof parsed.taskId === "number") taskId = String(parsed.taskId);
    } catch {
      // A broken workflow.json contributes no task id, as `jq ... || true` did.
    }
  }
  return `${taskId}|${scopePart}|${repairs}`;
}

/** `realpath` with existence tolerance — resolves what exists, else null. */
export function realpathOrNull(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}
