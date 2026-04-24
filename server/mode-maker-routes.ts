/**
 * Mode Maker API routes — Fork, Play, Reset.
 *
 * Registered conditionally when modeName === "mode-maker".
 * All endpoints scoped under /api/mode-maker/.
 */

import type { Hono } from "hono";
import { existsSync, readFileSync, mkdirSync, writeFileSync, readdirSync, statSync, unlinkSync, rmdirSync } from "node:fs";
import { join, dirname, basename, resolve } from "node:path";
import { tmpdir, homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { parseManifestTs } from "../core/utils/manifest-parser.js";
import { applyTemplateParams } from "./skill-installer.js";
import { readAndValidateManifest, getModeArchiveKey, getModeLatestKey } from "../snapshot/mode-publish.js";
import { loadCredentials, uploadToR2, uploadJsonToR2, checkR2KeyExists } from "../snapshot/r2.js";
import { createModeArchive } from "../snapshot/archive.js";
import { buildModeForPublish, cleanModeBuild } from "../snapshot/mode-build.js";

interface ModeMakerOptions {
  workspace: string;
  projectRoot: string;
  isDev?: boolean;
}

const PROTECTED_DIRS = new Set([".pneuma", ".claude", ".git", "node_modules", ".build"]);
const PLAY_PORT = 18997;
const PLAY_VITE_PORT = 18996;

/** Recursively list files in a directory, skipping protected dirs. Returns relative paths. */
function listFilesRecursive(dir: string, base: string = ""): string[] {
  const results: string[] = [];
  let entries: ReturnType<typeof readdirSync>;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (PROTECTED_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      results.push(...listFilesRecursive(join(dir, entry.name), rel));
    } else {
      results.push(rel);
    }
  }
  return results;
}

/** Delete all non-protected files and empty directories from workspace. */
function clearWorkspace(workspace: string): number {
  let count = 0;

  function walk(dir: string) {
    let entries: ReturnType<typeof readdirSync>;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (PROTECTED_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
        walk(full);
        // Try removing now-empty directory
        try { rmdirSync(full); } catch { /* not empty */ }
      } else {
        try {
          unlinkSync(full);
          count++;
        } catch { /* skip */ }
      }
    }
  }

  walk(workspace);
  return count;
}

/** Recursively copy a directory tree, applying template params to text files. */
const TEMPLATE_EXTENSIONS = new Set([".md", ".txt", ".html", ".css", ".json", ".ts", ".tsx", ".js", ".jsx"]);
const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

/**
 * Rewrite imports that escape the source mode directory into portable
 * `pneuma-skills/...` bare-specifier form. Previously this computed a
 * machine-specific relative path (`../../Codes/pneuma-skills/core/...`)
 * that only worked on the author's exact disk layout — useless once the
 * workspace was moved or the mode was published.
 *
 * The bare-specifier form is resolved by:
 *   - Vite dev: `pneumaWorkspaceResolve` plugin rewrites to project root
 *   - Bun.build (publish): resolver plugin in snapshot/mode-build.ts
 *
 * Imports that stay inside the mode's own directory pass through unchanged.
 * Imports that escape but don't land in `/core/` or `/src/` (rare; we don't
 * expect any) also pass through — we'd rather have a clear build error
 * than silently rewrite something unintended.
 */
function rewriteEscapingImports(
  text: string,
  srcFilePath: string,
  srcRoot: string,
  _dstFilePath: string,
): string {
  return text.replace(
    /((?:from|import\()\s*["'])(\.\.\/[^"']+)(["'])/g,
    (match, prefix, importPath, suffix) => {
      const resolved = resolve(dirname(srcFilePath), importPath);
      // Stays inside the mode — keep original.
      if (resolved.startsWith(srcRoot + "/") || resolved === srcRoot) {
        return match;
      }
      // Escapes the mode. Find the first /core/ or /src/ segment and
      // rebuild as a pneuma-skills/<rest> bare specifier. This preserves
      // the file extension the author wrote (.js convention over .ts
      // source, typical for bundler moduleResolution).
      for (const prefix2 of ["/core/", "/src/"]) {
        const idx = resolved.indexOf(prefix2);
        if (idx !== -1) {
          return `${prefix}pneuma-skills${resolved.slice(idx)}${suffix}`;
        }
      }
      return match;
    },
  );
}

interface CopyOptions {
  params?: Record<string, number | string>;
  /** When set, rewrite imports that escape srcRoot to correct relative paths from dst */
  rewriteImports?: boolean;
  /**
   * Source mode name (e.g. "slide"). When set, `init.seedFiles` keys
   * referencing the source mode's own seed directory ("modes/slide/seed/...")
   * get rewritten to the workspace-relative form ("seed/...") so the forked
   * manifest's seedFiles resolve against the workspace root instead of
   * against the unrelated `modes/slide/` path inside pneuma-skills itself.
   */
  sourceModeName?: string;
}

function copyDirRecursive(
  src: string,
  dst: string,
  options?: CopyOptions,
): { files: string[]; count: number } {
  const { params, rewriteImports, sourceModeName } = options || {};
  const files: string[] = [];
  const resolvedSrc = resolve(src);

  function walk(srcDir: string, dstDir: string, relBase: string) {
    let entries: ReturnType<typeof readdirSync>;
    try {
      entries = readdirSync(srcDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const srcPath = join(srcDir, entry.name);
      const dstPath = join(dstDir, entry.name);
      const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (PROTECTED_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
        mkdirSync(dstPath, { recursive: true });
        walk(srcPath, dstPath, rel);
      } else {
        mkdirSync(dirname(dstPath), { recursive: true });
        const ext = entry.name.slice(entry.name.lastIndexOf(".")).toLowerCase();
        const isText = TEMPLATE_EXTENSIONS.has(ext);

        if (isText) {
          let text = readFileSync(srcPath, "utf-8");
          // Apply template params
          if (params && Object.keys(params).length > 0) {
            text = applyTemplateParams(text, params);
          }
          // Rewrite escaping imports in code files
          if (rewriteImports && CODE_EXTENSIONS.has(ext)) {
            text = rewriteEscapingImports(text, srcPath, resolvedSrc, dstPath);
          }
          // Rewrite seedFiles paths in manifest.ts to workspace-relative form
          if (sourceModeName && (entry.name === "manifest.ts" || entry.name === "manifest.js")) {
            text = rewriteSeedFilePaths(text, sourceModeName);
          }
          writeFileSync(dstPath, text, "utf-8");
        } else {
          writeFileSync(dstPath, readFileSync(srcPath));
        }
        files.push(rel);
      }
    }
  }

  walk(src, dst, "");
  return { files, count: files.length };
}

/**
 * Rewrite `init.seedFiles` keys that reference the source mode's own seed
 * directory to be relative to the forked workspace root. After fork, the
 * source mode's `seed/` contents live at `<workspace>/seed/...` — not at
 * `<workspace>/modes/<sourceModeName>/seed/...` where the original key
 * pointed. Bin/pneuma.ts's init loop resolves seedFiles against the mode's
 * package directory for local modes, so the shorter form actually finds
 * the copied seeds.
 */
function rewriteSeedFilePaths(text: string, sourceModeName: string): string {
  const prefix = `modes/${sourceModeName}/`;
  // Match quoted keys that start with the prefix. Preserve the quote style.
  return text.replace(
    new RegExp(`(["'])${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^"']*)\\1`, "g"),
    (_, q, rest) => `${q}${rest}${q}`,
  );
}

/**
 * Ensure a forked workspace has a package.json that lists every runtime
 * dependency the builtin modes might import. Without this, `Bun.build`
 * at publish time fails to resolve things like `@dnd-kit/core` or
 * `@zumer/snapdom` because builtin modes under `modes/slide/`,
 * `modes/draw/`, etc. don't ship their own package.json — they rely on
 * pneuma-skills' root `node_modules`.
 *
 * After this runs, the workspace is a standalone package that `bun
 * install` can complete from and that publish can bundle.
 */
async function ensureForkedPackageJson(
  workspace: string,
  projectRoot: string,
  modeName: string,
): Promise<void> {
  const pkgPath = join(workspace, "package.json");
  if (existsSync(pkgPath)) return; // author already supplied one — leave it

  try {
    const rootPkgRaw = readFileSync(join(projectRoot, "package.json"), "utf-8");
    const rootPkg = JSON.parse(rootPkgRaw) as { dependencies?: Record<string, string> };
    const pkg = {
      name: modeName,
      private: true,
      dependencies: rootPkg.dependencies ?? {},
    };
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
    console.log(`[mode-maker/fork] Wrote package.json (${Object.keys(pkg.dependencies).length} deps) for forked mode "${modeName}"`);
  } catch (err) {
    console.warn(`[mode-maker/fork] Could not generate package.json:`, err instanceof Error ? err.message : String(err));
    return;
  }

  // Install deps so Bun.build has everything it needs at publish time.
  // Fire-and-forget — we log success/failure but don't block the fork
  // response on it, since many fork use cases don't need node_modules
  // immediately (only publish does). bun.lock ensures subsequent installs
  // are deterministic.
  try {
    const proc = Bun.spawn(["bun", "install"], {
      cwd: workspace,
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      console.warn(`[mode-maker/fork] bun install exit=${exitCode}: ${stderr.slice(0, 500)}`);
    } else {
      console.log(`[mode-maker/fork] bun install completed for "${modeName}"`);
    }
  } catch (err) {
    console.warn(`[mode-maker/fork] bun install failed to spawn:`, err instanceof Error ? err.message : String(err));
  }
}

// ── Play state ─────────────────────────────────────────────────────────────

interface ActivePlay {
  proc: ReturnType<typeof Bun.spawn>;
  pid: number;
  port: number;
  url: string;
  tmpDir: string;
}

let activePlay: ActivePlay | null = null;

function cleanupPlay() {
  if (!activePlay) return;
  try { activePlay.proc.kill(); } catch { /* already dead */ }
  // Clean up tmpDir
  try {
    const files = listFilesRecursive(activePlay.tmpDir);
    for (const f of files) {
      try { unlinkSync(join(activePlay.tmpDir, f)); } catch { /* skip */ }
    }
    // Remove directories bottom-up
    function rmDirs(dir: string) {
      try {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (entry.isDirectory()) rmDirs(join(dir, entry.name));
        }
        rmdirSync(dir);
      } catch { /* skip */ }
    }
    rmDirs(activePlay.tmpDir);
  } catch { /* tmpDir cleanup failed, not critical */ }
  activePlay = null;
}

// ── Route registration ─────────────────────────────────────────────────────

export function registerModeMakerRoutes(app: Hono, opts: ModeMakerOptions): () => void {
  const { workspace, projectRoot } = opts;
  const modesDir = join(projectRoot, "modes");

  // GET /api/mode-maker/modes — list builtin + local modes available for forking
  app.get("/api/mode-maker/modes", (c) => {
    interface ModeEntry { name: string; displayName?: string; description?: string; icon?: string; version?: string; source: "builtin" | "local"; path?: string; fileCount: number }
    const modes: ModeEntry[] = [];

    // Scan builtin modes
    try {
      const entries = readdirSync(modesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name === "mode-maker") continue;
        const manifestPath = join(modesDir, entry.name, "manifest.ts");
        if (!existsSync(manifestPath)) continue;
        const content = readFileSync(manifestPath, "utf-8");
        const parsed = parseManifestTs(content);
        const files = listFilesRecursive(join(modesDir, entry.name));
        modes.push({
          name: entry.name,
          displayName: parsed.displayName,
          description: parsed.description,
          icon: parsed.icon,
          version: "builtin",
          source: "builtin",
          fileCount: files.length,
        });
      }
    } catch { /* modes dir scan failed */ }

    // Scan local modes from ~/.pneuma/modes/
    const localModesDir = join(homedir(), ".pneuma", "modes");
    try {
      if (existsSync(localModesDir)) {
        const entries = readdirSync(localModesDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const entryPath = join(localModesDir, entry.name);
          // Note: we don't skip workspace-self here — user may want to re-import
          const manifestFile = ["manifest.ts", "manifest.js"].find((f) => existsSync(join(entryPath, f)));
          if (!manifestFile) continue;
          const content = readFileSync(join(entryPath, manifestFile), "utf-8");
          const parsed = parseManifestTs(content);
          const files = listFilesRecursive(entryPath);
          modes.push({
            name: parsed.name || entry.name,
            displayName: parsed.displayName,
            description: parsed.description,
            icon: parsed.icon,
            version: parsed.version || "local",
            source: "local",
            path: entryPath,
            fileCount: files.length,
          });
        }
      }
    } catch { /* local modes scan failed */ }

    return c.json({ modes });
  });

  // POST /api/mode-maker/fork — copy a builtin or local mode's files into workspace
  app.post("/api/mode-maker/fork", async (c) => {
    try {
      const body = await c.req.json<{ sourceMode: string; sourcePath?: string; overwrite?: boolean }>();
      if (!body.sourceMode) {
        return c.json({ success: false, message: "sourceMode is required" }, 400);
      }

      // Resolve source: explicit path (local mode) or builtin by name
      let sourceDir = body.sourcePath || join(modesDir, body.sourceMode);
      if (!existsSync(sourceDir) || !["manifest.ts", "manifest.js"].some((f) => existsSync(join(sourceDir, f)))) {
        return c.json({ success: false, message: `Mode "${body.sourceMode}" not found` }, 404);
      }

      // Check if workspace has existing files
      const existingFiles = listFilesRecursive(workspace);
      if (existingFiles.length > 0 && !body.overwrite) {
        return c.json({
          success: false,
          requireConfirmation: true,
          existingFileCount: existingFiles.length,
          message: `Workspace has ${existingFiles.length} existing file(s). Set overwrite: true to proceed.`,
        });
      }

      // Clear existing workspace contents before copy — otherwise files
      // unique to the previous mode (e.g. a blank seed's viewer/Preview.tsx
      // sitting next to slide's viewer/SlidePreview.tsx) would linger as
      // unreferenced clutter. copyDirRecursive would merge rather than
      // replace, leaving those stale files in place.
      if (existingFiles.length > 0) clearWorkspace(workspace);

      // Copy all files from source mode to workspace, rewriting escaping imports
      const { files, count } = copyDirRecursive(sourceDir, workspace, {
        rewriteImports: true,
        sourceModeName: body.sourceMode,
      });

      // Builtin modes don't ship package.json — synthesize one so the
      // forked workspace is a standalone package that Bun.build can
      // bundle at publish time.
      await ensureForkedPackageJson(workspace, projectRoot, body.sourceMode);

      return c.json({ success: true, filesWritten: count, files });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return c.json({ success: false, message }, 500);
    }
  });

  // POST /api/mode-maker/fork-url — download a mode from URL, then fork into workspace
  app.post("/api/mode-maker/fork-url", async (c) => {
    try {
      const body = await c.req.json<{ url: string; overwrite?: boolean }>();
      if (!body.url) {
        return c.json({ success: false, message: "url is required" }, 400);
      }

      // Infer mode name from URL (e.g. .../modes/my-mode/1.0.0.tar.gz → my-mode)
      const urlParts = body.url.replace(/\/$/, "").split("/");
      const tarIdx = urlParts.findIndex((p) => p.endsWith(".tar.gz"));
      let modeName = tarIdx > 0 ? urlParts[tarIdx - 1] : `url-mode-${Date.now()}`;
      // Fallback: use filename without extension
      if (modeName.endsWith(".tar.gz")) modeName = modeName.replace(/\.tar\.gz$/, "");

      const localModesDir = join(homedir(), ".pneuma", "modes");
      const targetDir = join(localModesDir, modeName);
      mkdirSync(localModesDir, { recursive: true });

      // Download
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60_000);
      try {
        const response = await fetch(body.url, { signal: controller.signal });
        if (!response.ok) {
          return c.json({ success: false, message: `Download failed: HTTP ${response.status}` }, 400);
        }

        // Save to temp file
        const tempPath = join(tmpdir(), `pneuma-dl-${Date.now()}.tar.gz`);
        const arrayBuf = await response.arrayBuffer();
        writeFileSync(tempPath, Buffer.from(arrayBuf));

        // Clean existing target and extract
        if (existsSync(targetDir)) {
          const { rmSync } = await import("node:fs");
          rmSync(targetDir, { recursive: true, force: true });
        }
        mkdirSync(targetDir, { recursive: true });

        const proc = Bun.spawn(["tar", "xzf", tempPath, "-C", targetDir], {
          stdout: "pipe", stderr: "pipe",
        });
        const exitCode = await proc.exited;
        try { unlinkSync(tempPath); } catch {}

        if (exitCode !== 0) {
          return c.json({ success: false, message: "Failed to extract archive" }, 500);
        }
      } finally {
        clearTimeout(timeout);
      }

      // Validate
      if (!["manifest.ts", "manifest.js"].some((f) => existsSync(join(targetDir, f)))) {
        return c.json({ success: false, message: "Downloaded archive does not contain a valid mode package (no manifest.ts)" }, 400);
      }

      // Check workspace files
      const existingFiles = listFilesRecursive(workspace);
      if (existingFiles.length > 0 && !body.overwrite) {
        return c.json({
          success: false,
          requireConfirmation: true,
          modeName,
          existingFileCount: existingFiles.length,
          message: `Workspace has ${existingFiles.length} existing file(s). Set overwrite: true to proceed.`,
        });
      }

      // Clear existing workspace contents (see fork route for rationale)
      if (existingFiles.length > 0) clearWorkspace(workspace);

      // Fork into workspace
      const { files, count } = copyDirRecursive(targetDir, workspace, {
        rewriteImports: true,
        sourceModeName: modeName,
      });

      await ensureForkedPackageJson(workspace, projectRoot, modeName);

      return c.json({ success: true, filesWritten: count, files, modeName });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return c.json({ success: false, message }, 500);
    }
  });

  // POST /api/mode-maker/play — start a test instance of the mode being developed
  app.post("/api/mode-maker/play", async (c) => {
    try {
      if (activePlay) {
        console.warn("[mode-maker/play] rejected — another play instance is already running");
        return c.json({ success: false, message: "A play instance is already running" }, 409);
      }

      // Create temporary workspace
      const uuid8 = randomUUID().slice(0, 8);
      const tmpDir = join(tmpdir(), `pneuma-play-${uuid8}`);
      mkdirSync(tmpDir, { recursive: true });
      console.log(`[mode-maker/play] tmpDir=${tmpDir} source=${workspace}`);

      // Launch subprocess: workspace path acts as local mode source.
      // Always use --dev (Vite) for play — Bun.build would duplicate src/store.ts
      // creating a separate Zustand store instance, breaking host state sharing.
      // Vite deduplicates modules by file path, so useStore is shared correctly.
      const args = ["bun", join(projectRoot, "bin", "pneuma.ts"), workspace, "--workspace", tmpDir, "--port", String(PLAY_PORT), "--no-open", "--no-prompt", "--dev"];

      const childEnv: Record<string, string> = {
        ...process.env as Record<string, string>,
        // Don't inherit CLAUDECODE env var
        CLAUDECODE: "",
        PNEUMA_VITE_PORT: String(PLAY_VITE_PORT),
      };

      console.log(`[mode-maker/play] spawn: ${args.join(" ")} (PNEUMA_VITE_PORT=${PLAY_VITE_PORT})`);
      const proc = Bun.spawn(args, {
          cwd: projectRoot,
          stdout: "pipe",
          stderr: "pipe",
          env: childEnv,
        },
      );
      console.log(`[mode-maker/play] child pid=${proc.pid}`);

      // Wait for the subprocess to print its ready URL (up to 30s — Vite
      // startup can be slow). Capture stderr too; the earlier code ignored
      // it entirely, which made crashes invisible. On timeout or early
      // exit the promise resolves to an `error` result — NOT a fabricated
      // URL — so the UI can surface the failure instead of opening a dead
      // window.
      type ReadyResult = { ok: true; url: string } | { ok: false; error: string };
      const readyPromise = new Promise<ReadyResult>((resolve) => {
        const recentStderr: string[] = [];
        let settled = false;
        const settle = (result: ReadyResult, reason: string) => {
          if (settled) return;
          settled = true;
          console.log(`[mode-maker/play] ready resolved (${reason}): ${result.ok ? result.url : "ERROR: " + result.error}`);
          clearTimeout(timeout);
          resolve(result);
        };
        const timeout = setTimeout(() => {
          const tail = recentStderr.slice(-5).join("\n") || "(no stderr output)";
          console.error(`[mode-maker/play] TIMEOUT after 30s — no "[pneuma] ready" signal. Recent stderr:\n${tail}`);
          settle({ ok: false, error: `Play child did not become ready within 30s. Recent stderr:\n${tail}` }, "timeout");
        }, 30_000);

        const pipeStream = async (stream: ReadableStream<Uint8Array>, tag: "stdout" | "stderr") => {
          const reader = stream.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                console.log(`[mode-maker/play:${tag}] <EOF>`);
                break;
              }
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop() || "";
              for (const line of lines) {
                if (line.length === 0) continue;
                console.log(`[mode-maker/play:${tag}] ${line}`);
                if (tag === "stderr") {
                  recentStderr.push(line);
                  if (recentStderr.length > 30) recentStderr.shift();
                }
                const match = line.match(/\[pneuma\] ready (http:\/\/\S+)/);
                if (match) settle({ ok: true, url: match[1] }, `${tag} match`);
              }
            }
          } catch (err) {
            console.error(`[mode-maker/play:${tag}] reader error:`, err instanceof Error ? err.message : String(err));
          }
        };

        if (proc.stdout && typeof proc.stdout !== "number") pipeStream(proc.stdout, "stdout");
        else console.warn("[mode-maker/play] proc.stdout not readable — ready signal will never fire");
        if (proc.stderr && typeof proc.stderr !== "number") pipeStream(proc.stderr, "stderr");

        proc.exited.then((code) => {
          console.log(`[mode-maker/play] child exited with code=${code}`);
          if (!settled) {
            const tail = recentStderr.slice(-5).join("\n") || "(no stderr output)";
            settle(
              { ok: false, error: `Play child exited (code=${code}) before printing ready signal. Recent stderr:\n${tail}` },
              `exit code=${code}`,
            );
          }
        });
      });

      const ready = await readyPromise;
      if (!ready.ok) {
        try { proc.kill(); } catch { /* already dead */ }
        try {
          // Best-effort tmpDir cleanup since we never registered activePlay
          const files2 = listFilesRecursive(tmpDir);
          for (const f of files2) {
            try { unlinkSync(join(tmpDir, f)); } catch {}
          }
          try { rmdirSync(tmpDir); } catch {}
        } catch { /* not critical */ }
        return c.json({ success: false, message: ready.error }, 500);
      }
      const port = parseInt(new URL(ready.url).port, 10) || PLAY_PORT;

      activePlay = {
        proc,
        pid: proc.pid,
        port,
        url: ready.url,
        tmpDir,
      };

      // Auto-cleanup when process exits
      proc.exited.then(() => {
        if (activePlay?.proc === proc) {
          // Clean tmpDir
          try {
            function rmRecursive(dir: string) {
              try {
                for (const entry of readdirSync(dir, { withFileTypes: true })) {
                  const full = join(dir, entry.name);
                  if (entry.isDirectory()) rmRecursive(full);
                  else unlinkSync(full);
                }
                rmdirSync(dir);
              } catch { /* skip */ }
            }
            rmRecursive(activePlay.tmpDir);
          } catch { /* not critical */ }
          activePlay = null;
        }
      });

      return c.json({ success: true, pid: proc.pid, port, url: ready.url, tmpDir });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return c.json({ success: false, message }, 500);
    }
  });

  // POST /api/mode-maker/play/stop — stop the running test instance
  app.post("/api/mode-maker/play/stop", (c) => {
    if (activePlay) {
      try { activePlay.proc.kill(); } catch { /* already dead */ }
      // exited handler will clean up
    }
    return c.json({ success: true });
  });

  // GET /api/mode-maker/play/status — check if a play instance is running
  app.get("/api/mode-maker/play/status", (c) => {
    if (activePlay) {
      return c.json({
        running: true,
        pid: activePlay.pid,
        port: activePlay.port,
        url: activePlay.url,
      });
    }
    return c.json({ running: false });
  });

  // POST /api/mode-maker/publish — publish mode package to R2
  app.post("/api/mode-maker/publish", async (c) => {
    try {
      const body = await c.req.json<{ force?: boolean }>().catch(() => ({}));

      // 1. Validate manifest
      let manifest: ReturnType<typeof readAndValidateManifest>;
      try {
        manifest = readAndValidateManifest(workspace);
      } catch (err) {
        return c.json({
          success: false,
          errorCode: "VALIDATION_ERROR",
          message: err instanceof Error ? err.message : "Manifest validation failed",
        }, 400);
      }

      // 2. Check pneuma-mode.ts exists
      if (!existsSync(join(workspace, "pneuma-mode.ts"))) {
        return c.json({
          success: false,
          errorCode: "VALIDATION_ERROR",
          message: "pneuma-mode.ts not found. A valid mode package requires this file.",
        }, 400);
      }

      // 3. Load credentials (non-interactive)
      const creds = loadCredentials();
      if (!creds) {
        return c.json({
          success: false,
          errorCode: "NO_CREDENTIALS",
          message: "R2 credentials not configured. Run `bunx pneuma-skills snapshot push` once from the CLI to set up credentials.",
        }, 400);
      }

      // 4. Check if version already exists
      const archiveKey = getModeArchiveKey(manifest.name, manifest.version);
      const exists = await checkR2KeyExists(archiveKey, creds);
      if (exists && !body.force) {
        return c.json({
          success: false,
          errorCode: "VERSION_EXISTS",
          message: `Version ${manifest.version} already published for "${manifest.name}". Use force to overwrite, or bump the version in manifest.ts.`,
        }, 409);
      }

      // 5. Pre-build viewer bundle (inlines third-party deps)
      const buildResult = await buildModeForPublish(workspace);
      if (!buildResult.success) {
        return c.json({
          success: false,
          errorCode: "BUILD_ERROR",
          message: `Viewer build failed:\n${buildResult.errors.join("\n")}`,
        }, 500);
      }

      // 6. Create archive (includes .build/ with inlined deps)
      const archiveName = `${manifest.name}-${manifest.version}.tar.gz`;
      const archivePath = join(tmpdir(), archiveName);
      await createModeArchive(workspace, archivePath);

      // Clean .build/ from workspace after archive captures it
      cleanModeBuild(workspace);

      // 7. Upload archive
      const publicUrl = await uploadToR2(archivePath, archiveKey, creds);

      // 8. Upload latest.json
      const latestKey = getModeLatestKey(manifest.name);
      const publishedAt = new Date().toISOString();
      await uploadJsonToR2({
        name: manifest.name,
        version: manifest.version,
        archiveUrl: publicUrl,
        displayName: manifest.displayName,
        publishedAt,
      }, latestKey, creds);

      // 9. Cleanup temp file
      try { unlinkSync(archivePath); } catch {}

      // 10. Return result
      const runCommand = `bunx pneuma-skills ${publicUrl} --workspace ~/pneuma-projects/${manifest.name}-workspace`;
      return c.json({
        success: true,
        name: manifest.name,
        version: manifest.version,
        url: publicUrl,
        publishedAt,
        runCommand,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return c.json({ success: false, errorCode: "PUBLISH_ERROR", message }, 500);
    }
  });

  // POST /api/mode-maker/reset — clear workspace and re-seed from templates
  app.post("/api/mode-maker/reset", async (c) => {
    try {
      const body = await c.req.json<{ confirmed?: boolean }>();
      if (!body.confirmed) {
        return c.json({
          requireConfirmation: true,
          message: "All files will be deleted and replaced with seed templates. .pneuma/ .claude/ .git/ are preserved.",
        });
      }

      // Read init params from config
      let params: Record<string, number | string> = {};
      const configPath = join(workspace, ".pneuma", "config.json");
      if (existsSync(configPath)) {
        try {
          params = JSON.parse(readFileSync(configPath, "utf-8"));
        } catch { /* use empty params */ }
      }

      // Clear all user files
      const filesDeleted = clearWorkspace(workspace);

      // Re-seed from mode-maker seed directory
      const seedDir = join(modesDir, "mode-maker", "seed");
      const seedFiles: string[] = [];
      let filesWritten = 0;

      if (existsSync(seedDir)) {
        const result = copyDirRecursive(seedDir, workspace, { params });
        seedFiles.push(...result.files);
        filesWritten = result.count;
      }

      return c.json({ success: true, filesDeleted, filesWritten, files: seedFiles });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return c.json({ success: false, message }, 500);
    }
  });

  // Return cleanup function
  return () => {
    cleanupPlay();
  };
}
