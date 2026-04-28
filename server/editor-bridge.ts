/**
 * Editor Bridge — detect installed code editors and open paths in them.
 *
 * Runs server-side (Bun.spawn for the actual `open -a` call). The frontend
 * gets a list of detected editors via `/api/system/editors` and triggers
 * opens via `/api/system/open-in-editor`.
 *
 * Detection strategy on macOS: check for `/Applications/<AppName>.app` or
 * `~/Applications/<AppName>.app`. We intentionally don't rely on the CLI
 * binaries (`code`, `cursor`, etc.) being on PATH — those are opt-in
 * installs in most editors and absence-on-PATH doesn't mean the app
 * isn't installed.
 *
 * Linux/Windows: not implemented yet — returns empty list. The feature
 * is gated by detection, so the UI just hides itself there until support
 * lands.
 */
import { existsSync, mkdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface DetectedEditor {
  /** Stable id used by the frontend to identify the chosen editor. */
  id: string;
  /** User-facing label shown in the dropdown. */
  displayName: string;
  /** macOS .app name passed to `open -a`. */
  appName: string;
}

/**
 * Known editors we attempt to detect, in display order. The list is
 * curated — broadly used editors first, then common alternatives. Adding
 * a new editor: just append to this list with its `.app` name.
 */
const KNOWN_EDITORS: ReadonlyArray<{
  id: string;
  displayName: string;
  appName: string;
}> = [
  { id: "vscode", displayName: "VS Code", appName: "Visual Studio Code" },
  { id: "cursor", displayName: "Cursor", appName: "Cursor" },
  { id: "windsurf", displayName: "Windsurf", appName: "Windsurf" },
  { id: "antigravity", displayName: "Antigravity", appName: "Antigravity" },
  { id: "zed", displayName: "Zed", appName: "Zed" },
  { id: "sublime", displayName: "Sublime Text", appName: "Sublime Text" },
  { id: "vscode-insiders", displayName: "VS Code Insiders", appName: "Visual Studio Code - Insiders" },
];

function findAppPath(appName: string): string | null {
  const candidates = [
    `/Applications/${appName}.app`,
    join(homedir(), "Applications", `${appName}.app`),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

function appExists(appName: string): boolean {
  return findAppPath(appName) !== null;
}

export function detectEditors(): DetectedEditor[] {
  if (process.platform !== "darwin") return [];
  return KNOWN_EDITORS.filter((e) => appExists(e.appName)).map((e) => ({
    id: e.id,
    displayName: e.displayName,
    appName: e.appName,
  }));
}

function findEditor(id: string): DetectedEditor | null {
  const all = detectEditors();
  return all.find((e) => e.id === id) ?? null;
}

export async function openInEditor(
  editorId: string,
  absPath: string,
): Promise<{ success: boolean; message?: string }> {
  if (process.platform !== "darwin") {
    return { success: false, message: "Only macOS is supported" };
  }
  const editor = findEditor(editorId);
  if (!editor) {
    return { success: false, message: `Editor not found: ${editorId}` };
  }
  if (!existsSync(absPath)) {
    return { success: false, message: "Path does not exist" };
  }
  try {
    const proc = Bun.spawn(["open", "-a", editor.appName, absPath], {
      stdout: "ignore",
      stderr: "pipe",
    });
    const code = await proc.exited;
    if (code !== 0) {
      const stderr = await new Response(proc.stderr).text();
      return { success: false, message: stderr.trim() || `open exited with code ${code}` };
    }
    return { success: true };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : "Unknown error" };
  }
}

// ── Icon extraction ──────────────────────────────────────────────────────
//
// Reads the .app's CFBundleIconFile from Info.plist, locates the .icns in
// Resources/, and converts it to PNG via macOS `sips`. Cached on disk
// keyed by the .icns mtime so app updates auto-invalidate the cache.

const ICON_CACHE_DIR = join(homedir(), ".pneuma", "cache", "editor-icons");

async function readPlistString(plistPath: string, key: string): Promise<string | null> {
  try {
    const proc = Bun.spawn(["plutil", "-extract", key, "raw", "-o", "-", plistPath], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const out = await new Response(proc.stdout).text();
    const code = await proc.exited;
    if (code !== 0) return null;
    const trimmed = out.trim();
    return trimmed || null;
  } catch {
    return null;
  }
}

function findIcnsInResources(appPath: string, iconNameHint: string | null): string | null {
  const resources = join(appPath, "Contents", "Resources");
  if (iconNameHint) {
    const candidate = iconNameHint.endsWith(".icns")
      ? join(resources, iconNameHint)
      : join(resources, `${iconNameHint}.icns`);
    if (existsSync(candidate)) return candidate;
  }
  // Common fallback names when CFBundleIconFile is missing or off.
  for (const name of ["AppIcon.icns", "Electron.icns", "app.icns"]) {
    const p = join(resources, name);
    if (existsSync(p)) return p;
  }
  return null;
}

export async function extractEditorIconPath(editorId: string): Promise<string | null> {
  if (process.platform !== "darwin") return null;
  const editor = KNOWN_EDITORS.find((e) => e.id === editorId);
  if (!editor) return null;
  const appPath = findAppPath(editor.appName);
  if (!appPath) return null;

  const infoPlist = join(appPath, "Contents", "Info.plist");
  const iconHint = await readPlistString(infoPlist, "CFBundleIconFile");
  const icnsPath = findIcnsInResources(appPath, iconHint);
  if (!icnsPath) return null;

  // Cache key: editor id + .icns mtime in ms. Apps updates bump mtime,
  // which gives us a different filename and effectively busts the cache.
  let mtimeMs: number;
  try {
    mtimeMs = statSync(icnsPath).mtimeMs;
  } catch {
    return null;
  }
  mkdirSync(ICON_CACHE_DIR, { recursive: true });
  const cachedPng = join(ICON_CACHE_DIR, `${editorId}-${Math.floor(mtimeMs)}.png`);
  if (existsSync(cachedPng)) return cachedPng;

  // Use `sips` to convert .icns → PNG at 128px (HiDPI-friendly; the UI
  // renders at 16-20px so the browser downscales).
  const proc = Bun.spawn(
    ["sips", "-s", "format", "png", "-Z", "128", icnsPath, "--out", cachedPng],
    { stdout: "ignore", stderr: "ignore" },
  );
  const code = await proc.exited;
  if (code !== 0 || !existsSync(cachedPng)) return null;
  return cachedPng;
}
