/**
 * Mode Resolver — 解析 mode 来源并确保本地可用。
 *
 * 支持三种 mode 来源:
 * - builtin: "doc", "slide" — 内置 mode，从 modes/ 目录加载
 * - local: "/abs/path" 或 "./rel/path" — 本地文件系统路径
 * - github: "github:user/repo" 或 "github:user/repo#branch" — GitHub 仓库
 *
 * GitHub 仓库会被 clone 到 ~/.pneuma/modes/{user}-{repo}/ 缓存目录。
 */

import { resolve, join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";

export type ModeSourceType = "builtin" | "local" | "github";

export interface ResolvedMode {
  /** Mode source type */
  type: ModeSourceType;
  /** Mode name (for display and registration) */
  name: string;
  /** Absolute filesystem path to the mode package directory */
  path: string;
  /** Original specifier as provided by the user */
  specifier: string;
}

/** Known builtin mode names */
const BUILTIN_MODES = new Set(["doc", "slide"]);

/** Global cache directory for cloned GitHub modes */
const MODES_CACHE_DIR = join(homedir(), ".pneuma", "modes");

/**
 * Parse a mode specifier and determine its source type.
 *
 * @param specifier — Mode specifier string
 * @param projectRoot — Absolute path to the pneuma-skills project root
 * @returns Parsed mode source info (not yet resolved to disk)
 */
export function parseModeSpecifier(specifier: string): {
  type: ModeSourceType;
  name: string;
  /** For github: { user, repo, ref } */
  github?: { user: string; repo: string; ref: string };
  /** For local: the raw path (may be relative) */
  localPath?: string;
} {
  // GitHub: "github:user/repo" or "github:user/repo#branch"
  if (specifier.startsWith("github:")) {
    const rest = specifier.slice("github:".length);
    const [repoPath, ref] = rest.split("#");
    const [user, repo] = repoPath.split("/");
    if (!user || !repo) {
      throw new Error(
        `Invalid GitHub mode specifier: "${specifier}". Expected format: github:user/repo or github:user/repo#branch`,
      );
    }
    return {
      type: "github",
      name: `${user}-${repo}`,
      github: { user, repo, ref: ref || "main" },
    };
  }

  // Local: starts with "/", "./", "../", or "~"
  if (
    specifier.startsWith("/") ||
    specifier.startsWith("./") ||
    specifier.startsWith("../") ||
    specifier.startsWith("~")
  ) {
    // Expand ~ to home directory
    const expandedPath = specifier.startsWith("~")
      ? join(homedir(), specifier.slice(1))
      : specifier;
    const absPath = resolve(expandedPath);
    // Extract mode name from directory name
    const name = absPath.split("/").pop() || "custom";
    return {
      type: "local",
      name,
      localPath: absPath,
    };
  }

  // Builtin: plain name
  if (BUILTIN_MODES.has(specifier)) {
    return { type: "builtin", name: specifier };
  }

  // Unknown — could be a builtin we don't know about, let mode-loader handle it
  return { type: "builtin", name: specifier };
}

/**
 * Resolve a mode specifier to a local directory path.
 * For GitHub modes, this clones/updates the repository.
 *
 * @param specifier — Mode specifier string (e.g. "doc", "./my-mode", "github:user/repo")
 * @param projectRoot — Absolute path to the pneuma-skills project root
 * @returns Resolved mode with absolute path
 */
export async function resolveMode(
  specifier: string,
  projectRoot: string,
): Promise<ResolvedMode> {
  const parsed = parseModeSpecifier(specifier);

  switch (parsed.type) {
    case "builtin": {
      return {
        type: "builtin",
        name: parsed.name,
        path: join(projectRoot, "modes", parsed.name),
        specifier,
      };
    }

    case "local": {
      const absPath = parsed.localPath!;
      if (!existsSync(absPath)) {
        throw new Error(`Local mode directory not found: ${absPath}`);
      }
      // Validate that it looks like a mode package
      validateModePackage(absPath);
      return {
        type: "local",
        name: parsed.name,
        path: absPath,
        specifier,
      };
    }

    case "github": {
      const { user, repo, ref } = parsed.github!;
      const cacheDir = join(MODES_CACHE_DIR, `${user}-${repo}`);
      await ensureGithubMode(user, repo, ref, cacheDir);
      validateModePackage(cacheDir);
      return {
        type: "github",
        name: parsed.name,
        path: cacheDir,
        specifier,
      };
    }
  }
}

/**
 * Validate that a directory looks like a pneuma mode package.
 * Must contain either manifest.ts or manifest.js.
 */
function validateModePackage(dir: string): void {
  const hasManifestTs = existsSync(join(dir, "manifest.ts"));
  const hasManifestJs = existsSync(join(dir, "manifest.js"));
  if (!hasManifestTs && !hasManifestJs) {
    throw new Error(
      `Invalid mode package at ${dir}: missing manifest.ts or manifest.js. ` +
        `A pneuma mode must export a ModeManifest from manifest.ts`,
    );
  }
}

/**
 * Clone or update a GitHub repository into the cache directory.
 */
async function ensureGithubMode(
  user: string,
  repo: string,
  ref: string,
  cacheDir: string,
): Promise<void> {
  mkdirSync(MODES_CACHE_DIR, { recursive: true });

  const repoUrl = `https://github.com/${user}/${repo}.git`;

  if (existsSync(join(cacheDir, ".git"))) {
    // Already cloned — fetch and checkout the ref
    console.log(`[mode-resolver] Updating ${user}/${repo}#${ref}...`);
    try {
      await runGit(["fetch", "origin", ref], cacheDir);
      await runGit(["checkout", `origin/${ref}`, "--force"], cacheDir);
      console.log(`[mode-resolver] Updated to latest ${ref}`);
    } catch (err) {
      console.warn(`[mode-resolver] Failed to update, using cached version:`, err);
    }
  } else {
    // Fresh clone
    console.log(`[mode-resolver] Cloning ${user}/${repo}#${ref}...`);
    await runGit(
      ["clone", "--depth", "1", "--branch", ref, repoUrl, cacheDir],
      MODES_CACHE_DIR,
    );
    console.log(`[mode-resolver] Cloned to ${cacheDir}`);
  }
}

/**
 * Run a git command and return the result.
 */
async function runGit(args: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();

  if (exitCode !== 0) {
    throw new Error(`git ${args[0]} failed (code ${exitCode}): ${stderr}`);
  }
  return stdout;
}

/**
 * Check if a mode specifier refers to a non-builtin (external) mode.
 */
export function isExternalMode(specifier: string): boolean {
  const parsed = parseModeSpecifier(specifier);
  return parsed.type !== "builtin";
}
