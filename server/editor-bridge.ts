/**
 * Editor Bridge — detect installed code editors and open paths in them.
 *
 * Runs server-side (Bun.spawn for the actual open call). The frontend gets
 * a list of detected editors via `/api/system/editors` and triggers opens
 * via `/api/system/open-in-editor`.
 *
 * Detection strategy on macOS: check for `/Applications/<AppName>.app` or
 * `~/Applications/<AppName>.app`.
 *
 * Opening strategy: **CLI-first**. `open -a "<App>" <file>` is unreliable
 * for the Electron editors — Cursor surfaces an error dialog, and other
 * forks just bring the app forward without opening the file (the
 * file-open Apple event gets dropped on a cold launch). Every VS Code
 * fork ships a CLI launcher (`code` / `cursor` / `windsurf` / …) that
 * talks to the running instance over IPC and opens files reliably. We
 * resolve that CLI from inside the `.app` bundle first (always present,
 * no PATH dependency), then fall back to a PATH lookup, then finally to
 * `open -a` for the rare native editor without a CLI. The CLI is spawned
 * with a sanitized env (`cleanEditorEnv`) so VS Code / Cursor terminal
 * IPC injections don't route the open through a crashing remote path.
 *
 * Window-focus + reveal: for a file we also hand the editor its enclosing
 * project folder (`buildOpenArgs` + `findProjectRoot`). VS Code / Cursor /
 * Zed / Sublime then focus the window that already has that folder open and
 * open the file inside it — so `explorer.autoReveal` locates it in the tree
 * instead of spawning a bare single-file window. An optional `line` jumps to
 * a position (`--goto` for VS Code forks, `:line` suffix for Zed/Sublime).
 *
 * Linux/Windows: not implemented yet — returns empty list. The feature
 * is gated by detection, so the UI just hides itself there until support
 * lands.
 */
import { existsSync, mkdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, parse as parsePath, relative, resolve } from "node:path";

export interface DetectedEditor {
  /** Stable id used by the frontend to identify the chosen editor. */
  id: string;
  /** User-facing label shown in the dropdown. */
  displayName: string;
  /** macOS .app name passed to `open -a` (fallback path). */
  appName: string;
}

interface KnownEditor {
  id: string;
  displayName: string;
  /**
   * Candidate macOS `.app` names, in preference order. The first one that
   * exists on disk wins. Antigravity ships two apps — the agents-first
   * "Antigravity" (no code editor, can't open files) and the standalone
   * "Antigravity IDE" — so we list the IDE first and only treat that as
   * the editor.
   */
  appNames: string[];
  /** PATH shim name (`which <cliShim>`) used as a secondary CLI source. */
  cliShim?: string;
  /**
   * Bundled CLI launcher paths relative to the `.app` root, in preference
   * order. These ship inside every VS Code fork and don't depend on the
   * user having installed the shell command on PATH.
   */
  bundledCli?: string[];
  /**
   * CLI argument dialect, used to build the open command. Decides how a
   * line number is expressed and whether passing a leading folder focuses
   * an already-open window:
   *   - "vscode" — `<folder> --goto <file>:<line>` (VS Code + every fork)
   *   - "zed"    — `<folder> <file>:<line>`
   *   - "sublime"— `<folder> <file>:<line>` (Sublime's `--goto`-free form)
   * All three focus an existing window for a folder that's already open;
   * absent/unknown family → plain `<file>` with no folder/line tricks.
   */
  family?: "vscode" | "zed" | "sublime";
}

/**
 * Known editors we attempt to detect, in display order. The list is
 * curated — broadly used editors first, then common alternatives.
 */
const KNOWN_EDITORS: ReadonlyArray<KnownEditor> = [
  {
    id: "vscode",
    displayName: "VS Code",
    appNames: ["Visual Studio Code"],
    cliShim: "code",
    bundledCli: ["Contents/Resources/app/bin/code"],
    family: "vscode",
  },
  {
    id: "cursor",
    displayName: "Cursor",
    appNames: ["Cursor"],
    cliShim: "cursor",
    bundledCli: ["Contents/Resources/app/bin/cursor"],
    family: "vscode",
  },
  {
    id: "windsurf",
    displayName: "Windsurf",
    appNames: ["Windsurf"],
    cliShim: "windsurf",
    bundledCli: ["Contents/Resources/app/bin/windsurf"],
    family: "vscode",
  },
  {
    id: "antigravity",
    displayName: "Antigravity",
    // "Antigravity IDE" is the actual code editor; plain "Antigravity" is
    // the agents-first app that can't open files. Prefer the IDE.
    appNames: ["Antigravity IDE", "Antigravity"],
    cliShim: "antigravity",
    bundledCli: [
      "Contents/Resources/app/bin/antigravity",
      "Contents/Resources/app/bin/code",
    ],
    family: "vscode",
  },
  {
    id: "zed",
    displayName: "Zed",
    appNames: ["Zed"],
    cliShim: "zed",
    bundledCli: ["Contents/MacOS/cli"],
    family: "zed",
  },
  {
    id: "sublime",
    displayName: "Sublime Text",
    appNames: ["Sublime Text"],
    cliShim: "subl",
    bundledCli: ["Contents/SharedSupport/bin/subl"],
    family: "sublime",
  },
  {
    id: "vscode-insiders",
    displayName: "VS Code Insiders",
    appNames: ["Visual Studio Code - Insiders"],
    cliShim: "code-insiders",
    bundledCli: ["Contents/Resources/app/bin/code-insiders"],
    family: "vscode",
  },
];

function findAppPath(appNames: string[]): string | null {
  for (const appName of appNames) {
    const candidates = [
      `/Applications/${appName}.app`,
      join(homedir(), "Applications", `${appName}.app`),
    ];
    const hit = candidates.find((p) => existsSync(p));
    if (hit) return hit;
  }
  return null;
}

export function detectEditors(): DetectedEditor[] {
  if (process.platform !== "darwin") return [];
  return KNOWN_EDITORS.flatMap((e) => {
    const appPath = findAppPath(e.appNames);
    if (!appPath) return [];
    // The chosen .app name (without extension / dir) — what `open -a`
    // needs in the fallback path.
    const appName = appPath.split("/").pop()!.replace(/\.app$/, "");
    return [{ id: e.id, displayName: e.displayName, appName }];
  });
}

function findEditor(id: string): KnownEditor | null {
  return KNOWN_EDITORS.find((e) => e.id === id) ?? null;
}

/**
 * Resolve a CLI launcher for the editor: bundled binary inside the
 * `.app` first (no PATH dependency), then a PATH shim. Returns the
 * absolute path to an executable that opens a file when invoked as
 * `<cli> <absPath>`, or null if none is available.
 */
async function resolveEditorCli(editor: KnownEditor): Promise<string | null> {
  const appPath = findAppPath(editor.appNames);
  if (appPath && editor.bundledCli) {
    for (const rel of editor.bundledCli) {
      const candidate = join(appPath, rel);
      if (existsSync(candidate)) return candidate;
    }
  }
  if (editor.cliShim) {
    try {
      const proc = Bun.spawn(["which", editor.cliShim], {
        stdout: "pipe",
        stderr: "ignore",
      });
      const out = (await new Response(proc.stdout).text()).trim();
      const code = await proc.exited;
      if (code === 0 && out && existsSync(out)) return out;
    } catch {
      // ignore — fall through to the open -a fallback
    }
  }
  return null;
}

/**
 * A clean environment for spawning the editor CLI launcher.
 *
 * VS Code and its forks (Cursor, Windsurf, …) inject IPC + askpass vars
 * into their integrated-terminal environments. When Pneuma is launched
 * from such a terminal — or from a desktop Electron shell — those vars
 * are inherited, and the bundled `cursor`/`code` launcher reads them:
 * `VSCODE_IPC_HOOK_CLI` flips it into "remote" mode and routes the open
 * over that socket. Recent Cursor crashes its agent panel on that path
 * ("AgentPanel failed to render — Cannot read properties of undefined
 * (reading 'trim')"). Stripping the injected vars makes the launcher do
 * a clean external open against the running instance instead.
 *
 * `ELECTRON_RUN_AS_NODE` is stripped for the same reason — if Pneuma's
 * own Electron leaks it, the launcher's Electron boots in node mode and
 * never opens a window.
 */
export function cleanEditorEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (k.startsWith("VSCODE_")) continue;
    if (k === "ELECTRON_RUN_AS_NODE" || k === "ELECTRON_NO_ATTACH_CONSOLE") continue;
    if (k === "GIT_ASKPASS" || k === "NODE_OPTIONS") continue;
    env[k] = v;
  }
  return env;
}

/** Project-root markers, in the order we'd trust them. The nearest
 *  ancestor of a file that contains any of these is treated as the
 *  "project" whose editor window should host the file. */
const PROJECT_ROOT_MARKERS = [
  ".git",
  ".pneuma",
  ".hg",
  ".svn",
  "package.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  ".vscode",
];

/**
 * Walk up from a file to the nearest ancestor directory that looks like a
 * project root (contains a `PROJECT_ROOT_MARKERS` entry). Returns null when
 * none is found before the filesystem / home boundary.
 *
 * Why: opening just `<file>` spawns a bare single-file editor window. If we
 * also hand the editor the enclosing project folder, VS Code / Cursor focus
 * the window that already has that folder open and reveal the file in the
 * explorer tree — the behavior users expect from clicking a file link.
 */
export function findProjectRoot(absFile: string): string | null {
  const home = resolve(homedir());
  const fsRoot = parsePath(absFile).root;
  let dir = dirname(resolve(absFile));
  // Bounded walk — stop at filesystem root, and don't climb past $HOME
  // (a marker in the home dir itself is too coarse to be a useful "project").
  for (let i = 0; i < 64; i++) {
    if (dir === home) return null;
    for (const marker of PROJECT_ROOT_MARKERS) {
      if (existsSync(join(dir, marker))) return dir;
    }
    if (dir === fsRoot) return null;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

/** True when `file` is `root` itself or nested anywhere beneath it. */
function isInside(file: string, root: string): boolean {
  const rel = relative(resolve(root), resolve(file));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Build the editor CLI argv for opening `absPath`.
 *
 * - Directory target → just `[dir]` (open/focus the folder; no line/root
 *   tricks make sense).
 * - File target → optionally prefix the enclosing project `root` so an
 *   already-open window is focused, then express the file (with an optional
 *   line) in the editor family's dialect.
 */
export function buildOpenArgs(
  editor: KnownEditor,
  absPath: string,
  root: string | null,
  line: number | null,
): string[] {
  let isDir = false;
  try {
    isDir = statSync(absPath).isDirectory();
  } catch {
    // ignore — treat as file
  }
  if (isDir) return [absPath];

  // Only the VS Code family + Zed + Sublime understand the folder-focus /
  // line conventions. Anything else gets the plain file path.
  const family = editor.family;
  const leading = root && isInside(absPath, root) && root !== absPath ? [root] : [];

  if (line && line > 0) {
    if (family === "vscode") return [...leading, "--goto", `${absPath}:${line}`];
    if (family === "zed" || family === "sublime") return [...leading, `${absPath}:${line}`];
    return [absPath];
  }
  if (family) return [...leading, absPath];
  return [absPath];
}

export interface OpenInEditorOptions {
  /** Project folder to focus/open alongside the file so the editor reuses an
   *  already-open window and reveals the file in its tree. When omitted, the
   *  nearest project root above the file is auto-detected. Pass `null` to
   *  opt out of the folder-focus behavior entirely. */
  root?: string | null;
  /** 1-based line to jump to (`--goto`). Ignored for directory targets. */
  line?: number | null;
}

export async function openInEditor(
  editorId: string,
  absPath: string,
  options: OpenInEditorOptions = {},
): Promise<{ success: boolean; message?: string }> {
  if (process.platform !== "darwin") {
    return { success: false, message: "Only macOS is supported" };
  }
  const editor = findEditor(editorId);
  if (!editor) {
    return { success: false, message: `Editor not found: ${editorId}` };
  }
  const appPath = findAppPath(editor.appNames);
  if (!appPath) {
    return { success: false, message: `Editor not installed: ${editor.displayName}` };
  }
  if (!existsSync(absPath)) {
    return { success: false, message: "Path does not exist" };
  }
  // Resolve the folder to focus: explicit `root` wins; `null` opts out;
  // `undefined` auto-detects the nearest project root above the file.
  const root =
    options.root === null
      ? null
      : options.root !== undefined && existsSync(options.root)
        ? options.root
        : findProjectRoot(absPath);
  const line = options.line ?? null;
  const args = buildOpenArgs(editor, absPath, root, line);
  try {
    // CLI-first: reliably opens the file in the running/launched instance.
    const env = cleanEditorEnv();
    const cli = await resolveEditorCli(editor);
    if (cli) {
      const proc = Bun.spawn([cli, ...args], { stdout: "ignore", stderr: "pipe", env });
      const code = await proc.exited;
      if (code === 0) return { success: true };
      // CLI present but failed — surface its stderr rather than silently
      // falling back, so a real error isn't masked.
      const stderr = await new Response(proc.stderr).text();
      return { success: false, message: stderr.trim() || `${editor.displayName} CLI exited with code ${code}` };
    }
    // Fallback: native editors without a CLI launcher (rare). `open -a`
    // can't express a folder-focus or a line, so it gets the bare path.
    const appName = appPath.split("/").pop()!.replace(/\.app$/, "");
    const proc = Bun.spawn(["open", "-a", appName, absPath], {
      stdout: "ignore",
      stderr: "pipe",
      env,
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
  const appPath = findAppPath(editor.appNames);
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
