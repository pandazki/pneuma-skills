/**
 * PATH discovery and binary resolution.
 * Ported from Companion — captures the user's real shell PATH at runtime.
 * Supports macOS, Linux, and Windows.
 */

import { execSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, delimiter } from "node:path";

const isWin = process.platform === "win32";

const MARKER_START = "___PNEUMA_PATH_START___";
const MARKER_END = "___PNEUMA_PATH_END___";

/**
 * The script we run inside the user's login shell to read their PATH.
 *
 * Two shell-portability traps are deliberately avoided here:
 *
 *  1. **Markers live on their own lines.** An earlier version interpolated
 *     the value as `"___PATH_START___$PATH___PATH_END___"`. Underscores are
 *     legal identifier characters, so bash, zsh *and* fish all parsed that
 *     as a single variable named `PATH___PATH_END___` — always empty. The
 *     regex never matched and this function silently fell back to
 *     `buildFallbackPath()` on every platform and every shell.
 *  2. **`printenv PATH`, not `echo $PATH`.** fish stores PATH as a list, so
 *     `echo $PATH` joins it with spaces instead of colons. `printenv` reads
 *     the exported (colon-delimited) value identically in every shell.
 *
 * `-i` (interactive) is required because many users only set PATH in
 * interactive rc files — which also means greeters like fastfetch can write
 * ANSI art to stdout. `parseCapturedPath` strips and validates accordingly.
 */
const CAPTURE_SCRIPT = `echo ${MARKER_START}; printenv PATH; echo ${MARKER_END}`;

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1B\[[0-?]*[ -/]*[@-~]/g;

/**
 * Extract the PATH from raw login-shell output, or null if the capture did
 * not produce a usable value. Exported for testing — this parse step is
 * where the historical breakage lived.
 */
export function parseCapturedPath(raw: string): string | null {
  const text = raw.replace(ANSI_PATTERN, "");
  const start = text.indexOf(MARKER_START);
  if (start === -1) return null;
  const end = text.indexOf(MARKER_END, start + MARKER_START.length);
  if (end === -1) return null;

  const body = text.slice(start + MARKER_START.length, end);
  // `printenv PATH` emits exactly one line; anything else is shell noise.
  const line = body.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0);
  if (!line) return null;

  // Guard against capturing greeter output instead of a real PATH.
  const entries = line.split(delimiter).filter(Boolean);
  if (!entries.some((dir) => dir.startsWith("/") && existsSync(dir))) return null;

  return line;
}

/**
 * Capture the user's full interactive shell PATH by spawning a login shell.
 * On Windows, process.env.PATH already contains the full user PATH.
 */
export function captureUserShellPath(): string {
  if (isWin) {
    return process.env.PATH || "";
  }

  try {
    const shell = process.env.SHELL || "/bin/bash";
    const captured = execSync(`${shell} -lic ${JSON.stringify(CAPTURE_SCRIPT)}`, {
      encoding: "utf-8",
      timeout: 10_000,
      env: {
        HOME: homedir(),
        USER: process.env.USER,
        SHELL: shell,
        // Bootstrap PATH so `printenv` resolves even if the rc files bail
        // out before setting one.
        PATH: "/usr/bin:/bin",
      },
    });
    const parsed = parseCapturedPath(captured);
    if (parsed) return parsed;
  } catch {
    // Shell sourcing failed
  }

  return buildFallbackPath();
}

/**
 * Build a PATH by probing common binary installation directories.
 */
export function buildFallbackPath(): string {
  const home = homedir();

  if (isWin) {
    const localAppData = process.env.LOCALAPPDATA || join(home, "AppData", "Local");
    const appData = process.env.APPDATA || join(home, "AppData", "Roaming");
    const pf = process.env["ProgramFiles"] || "C:\\Program Files";

    const candidates = [
      join(home, ".bun", "bin"),
      join(localAppData, "bun"),
      join(appData, "npm"),
      join(home, "scoop", "shims"),
      join(home, ".cargo", "bin"),
      join(home, ".deno", "bin"),
      join(home, "go", "bin"),
      join(pf, "Git", "cmd"),
      join(pf, "nodejs"),
      join(localAppData, "Programs", "Python"),
      join(localAppData, "fnm"),
      join(home, ".volta", "bin"),
    ];

    return [...new Set(candidates.filter((dir) => existsSync(dir)))].join(delimiter);
  }

  const candidates = [
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
    join(home, ".bun", "bin"),
    join(home, ".local", "bin"),
    // Agent CLIs that install outside the conventional bin dirs. Kimi Code
    // moved here from `~/.local/bin` when it rebranded; without this entry a
    // GUI-launched app cannot see it at all.
    join(home, ".kimi-code", "bin"),
    join(home, ".cargo", "bin"),
    join(home, ".volta", "bin"),
    join(home, ".local", "share", "mise", "shims"),
    join(home, ".pyenv", "bin"),
    join(home, ".pyenv", "shims"),
    join(home, "go", "bin"),
    "/usr/local/go/bin",
    join(home, ".deno", "bin"),
  ];

  const nvmDir = process.env.NVM_DIR || join(home, ".nvm");
  const nvmVersionsDir = join(nvmDir, "versions", "node");
  if (existsSync(nvmVersionsDir)) {
    try {
      for (const v of readdirSync(nvmVersionsDir)) {
        candidates.push(join(nvmVersionsDir, v, "bin"));
      }
    } catch { /* ignore */ }
  }

  const fnmDir = join(home, "Library", "Application Support", "fnm", "node-versions");
  if (existsSync(fnmDir)) {
    try {
      for (const v of readdirSync(fnmDir)) {
        candidates.push(join(fnmDir, v, "installation", "bin"));
      }
    } catch { /* ignore */ }
  }

  return [...new Set(candidates.filter((dir) => existsSync(dir)))].join(delimiter);
}

// ─── Enriched PATH (cached) ───────────────────────────────────────────────────

let _cachedPath: string | null = null;

/**
 * Returns an enriched PATH that merges the user's shell PATH, the current
 * process PATH, and the probed fallback dirs. Deduplicates entries; result is
 * cached after the first call.
 *
 * The fallback dirs are appended unconditionally (lowest precedence) rather
 * than only on capture failure. A GUI-launched app gets a minimal PATH from
 * the OS, and a successful-but-thin shell capture would otherwise still leave
 * agent CLIs undiscoverable.
 */
export function getEnrichedPath(): string {
  if (_cachedPath) return _cachedPath;

  const currentPath = process.env.PATH || "";
  const userPath = captureUserShellPath();

  const allDirs = [
    ...userPath.split(delimiter),
    ...currentPath.split(delimiter),
    ...buildFallbackPath().split(delimiter),
  ];
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const dir of allDirs) {
    if (dir && !seen.has(dir)) {
      seen.add(dir);
      deduped.push(dir);
    }
  }

  _cachedPath = deduped.join(delimiter);
  return _cachedPath;
}

/**
 * Resolve a binary name to an absolute path using the enriched PATH.
 * Returns null if the binary is not found anywhere.
 */
export function resolveBinary(name: string): string | null {
  // Check if name is an absolute path
  if (isWin ? /^[A-Za-z]:[\\/]/.test(name) : name.startsWith("/")) {
    return existsSync(name) ? name : null;
  }

  const enrichedPath = getEnrichedPath();
  const cmd = isWin ? "where" : "which";
  try {
    const resolved = execSync(`${cmd} ${name.replace(/[^a-zA-Z0-9._@/\\-]/g, "")}`, {
      encoding: "utf-8",
      timeout: 5_000,
      env: { ...process.env, PATH: enrichedPath },
    }).trim();
    // `where` on Windows may return multiple lines; take the first
    return (isWin ? resolved.split("\n")[0].trim() : resolved) || null;
  } catch {
    return null;
  }
}
