/**
 * System Bridge — OS-level operations triggered by the Viewer (frontend).
 *
 * The browser has no filesystem/OS access, so these functions run server-side
 * and are exposed via /api/system/* HTTP routes in server/index.ts.
 */

import { resolve, dirname } from "node:path";
import { existsSync } from "node:fs";

// ── Platform detection ───────────────────────────────────────────────────────

type Platform = "darwin" | "linux" | "win32";

function getPlatform(): Platform {
  return process.platform as Platform;
}

// ── Path validation ──────────────────────────────────────────────────────────

export function resolveAndValidate(workspace: string, inputPath: string): string {
  const abs = resolve(workspace, inputPath);
  const match = process.platform === "win32"
    ? abs.toLowerCase().startsWith(workspace.toLowerCase())
    : abs.startsWith(workspace);
  if (!match) {
    throw new Error("Path escapes workspace");
  }
  return abs;
}

// ── URL validation ───────────────────────────────────────────────────────────

export function validateUrl(url: string): void {
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("Only http:// and https:// URLs are allowed");
  }
}

// ── Shell command builders ───────────────────────────────────────────────────

function buildOpenCommand(absPath: string, platform: Platform): string[] {
  switch (platform) {
    case "darwin":
      return ["open", absPath];
    case "linux":
      return ["xdg-open", absPath];
    case "win32":
      return ["cmd", "/c", "start", "", absPath];
  }
}

function buildRevealCommand(absPath: string, platform: Platform): string[] {
  switch (platform) {
    case "darwin":
      return ["open", "-R", absPath];
    case "linux":
      // Linux has no native "reveal in file manager" — open the parent directory
      return ["xdg-open", dirname(absPath)];
    case "win32":
      return ["explorer", `/select,${absPath}`];
  }
}

function buildOpenUrlCommand(url: string, platform: Platform): string[] {
  switch (platform) {
    case "darwin":
      return ["open", url];
    case "linux":
      return ["xdg-open", url];
    case "win32":
      return ["cmd", "/c", "start", "", url];
  }
}

// ── Spawn helper ─────────────────────────────────────────────────────────────

async function spawn(cmd: string[]): Promise<void> {
  const proc = Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
  await proc.exited;
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function openPath(workspace: string, path: string): Promise<{ success: boolean; message?: string }> {
  try {
    const abs = resolveAndValidate(workspace, path);
    if (!existsSync(abs)) {
      return { success: false, message: "Path does not exist" };
    }
    await spawn(buildOpenCommand(abs, getPlatform()));
    return { success: true };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function revealPath(workspace: string, path: string): Promise<{ success: boolean; message?: string }> {
  try {
    const abs = resolveAndValidate(workspace, path);
    if (!existsSync(abs)) {
      return { success: false, message: "Path does not exist" };
    }
    await spawn(buildRevealCommand(abs, getPlatform()));
    return { success: true };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function openUrl(url: string): Promise<{ success: boolean; message?: string }> {
  try {
    validateUrl(url);
    await spawn(buildOpenUrlCommand(url, getPlatform()));
    return { success: true };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : "Unknown error" };
  }
}
