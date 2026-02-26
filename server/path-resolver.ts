/**
 * PATH discovery and binary resolution.
 * Ported from Companion — captures the user's real shell PATH at runtime.
 */

import { execSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Capture the user's full interactive shell PATH by spawning a login shell.
 */
export function captureUserShellPath(): string {
  try {
    const shell = process.env.SHELL || "/bin/bash";
    const captured = execSync(
      `${shell} -lic 'echo "___PATH_START___$PATH___PATH_END___"'`,
      {
        encoding: "utf-8",
        timeout: 10_000,
        env: { HOME: homedir(), USER: process.env.USER, SHELL: shell },
      },
    );
    const match = captured.match(/___PATH_START___(.+)___PATH_END___/);
    if (match?.[1]) {
      return match[1];
    }
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

  return [...new Set(candidates.filter((dir) => existsSync(dir)))].join(":");
}

// ─── Enriched PATH (cached) ───────────────────────────────────────────────────

let _cachedPath: string | null = null;

/**
 * Returns an enriched PATH that merges the user's shell PATH with the current
 * process PATH. Deduplicates entries. Result is cached after the first call.
 */
export function getEnrichedPath(): string {
  if (_cachedPath) return _cachedPath;

  const currentPath = process.env.PATH || "";
  const userPath = captureUserShellPath();

  const allDirs = [...userPath.split(":"), ...currentPath.split(":")];
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const dir of allDirs) {
    if (dir && !seen.has(dir)) {
      seen.add(dir);
      deduped.push(dir);
    }
  }

  _cachedPath = deduped.join(":");
  return _cachedPath;
}

/**
 * Resolve a binary name to an absolute path using the enriched PATH.
 * Returns null if the binary is not found anywhere.
 */
export function resolveBinary(name: string): string | null {
  if (name.startsWith("/")) {
    return existsSync(name) ? name : null;
  }

  const enrichedPath = getEnrichedPath();
  try {
    const resolved = execSync(`which ${name.replace(/[^a-zA-Z0-9._@/-]/g, "")}`, {
      encoding: "utf-8",
      timeout: 5_000,
      env: { ...process.env, PATH: enrichedPath },
    }).trim();
    return resolved || null;
  } catch {
    return null;
  }
}
