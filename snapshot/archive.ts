/**
 * Archive creation and extraction via system `tar` command.
 */

import { join } from "node:path";

const BASE_EXCLUDES = [
  ".git",
  "node_modules",
  ".pneuma/session.json",
  ".pneuma/history.json",
  ".DS_Store",
];

/** Extra excludes when including .claude/ skills — only keep .claude/skills/ (minus .env) */
const CLAUDE_DIR_EXCLUDES = [
  ".claude/settings.json",
  ".claude/projects",
  ".claude/credentials",
  ".claude/statsig",
  ".claude/todos",
  ".claude/mcp.json",
  ".claude/skills/*/.env",   // generated env files contain API keys
];

export interface ArchiveOptions {
  includeSkills?: boolean;
  /** Param names declared as sensitive in ModeManifest — stripped from config.json */
  sensitiveKeys?: string[];
}

/**
 * Create a tar.gz archive of the workspace directory.
 *
 * - Default: excludes .claude/ entirely
 * - includeSkills: includes .claude/skills/ only (strips settings, projects, .env files)
 * - sensitiveKeys: param names from manifest (sensitive: true) — cleared in config.json
 */
export async function createArchive(
  workspace: string,
  outputPath: string,
  options?: ArchiveOptions,
): Promise<string> {
  const { existsSync, readFileSync, writeFileSync, renameSync } = await import("node:fs");

  // Sanitize config.json — strip manifest-declared sensitive fields
  const configPath = join(workspace, ".pneuma", "config.json");
  let configBackupPath: string | null = null;
  const sensitiveKeys = options?.sensitiveKeys ?? [];

  if (sensitiveKeys.length > 0 && existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, "utf-8");
      const config = JSON.parse(raw);
      const sanitized = sanitizeConfig(config, sensitiveKeys);
      if (JSON.stringify(config) !== JSON.stringify(sanitized)) {
        configBackupPath = configPath + ".bak";
        renameSync(configPath, configBackupPath);
        writeFileSync(configPath, JSON.stringify(sanitized, null, 2));
      }
    } catch {}
  }

  const excludes = [...BASE_EXCLUDES];
  if (options?.includeSkills) {
    excludes.push(...CLAUDE_DIR_EXCLUDES);
  } else {
    excludes.push(".claude");
  }
  const excludeArgs = excludes.flatMap((p) => ["--exclude", p]);

  const proc = Bun.spawn(["tar", "czf", outputPath, ...excludeArgs, "."], {
    cwd: workspace,
    stdout: "pipe",
    stderr: "pipe",
  });

  const exitCode = await proc.exited;

  // Restore original config.json
  if (configBackupPath) {
    const { unlinkSync } = await import("node:fs");
    try { unlinkSync(configPath); } catch {}
    renameSync(configBackupPath, configPath);
  }

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`tar create failed (exit ${exitCode}): ${stderr}`);
  }

  return outputPath;
}

/**
 * Strip sensitive values from config. Only clears keys explicitly declared
 * as sensitive in the ModeManifest — no guessing.
 */
function sanitizeConfig(
  config: Record<string, unknown>,
  sensitiveKeys: string[],
): Record<string, unknown> {
  const keySet = new Set(sensitiveKeys);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    result[key] = keySet.has(key) ? "" : value;
  }
  return result;
}

/**
 * Extract a tar.gz archive into the target directory.
 */
export async function extractArchive(
  archivePath: string,
  targetDir: string,
): Promise<void> {
  const { mkdirSync } = await import("node:fs");
  mkdirSync(targetDir, { recursive: true });

  const proc = Bun.spawn(["tar", "xzf", archivePath, "-C", targetDir], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`tar extract failed (exit ${exitCode}): ${stderr}`);
  }
}
