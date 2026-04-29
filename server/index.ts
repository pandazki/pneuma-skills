import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, unlinkSync, mkdirSync } from "node:fs";
import { join, resolve, relative, basename, dirname, sep } from "node:path";
import { execSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { WsBridge } from "./ws-bridge.js";
import { getBackendDescriptors, getDefaultBackendType, detectBackendAvailability } from "../backends/index.js";
import type { AgentBackendType } from "../core/types/agent-backend.js";
import type { SocketData } from "./ws-bridge.js";
import type { TerminalSocketData } from "./ws-bridge-types.js";
import type { ServerWebSocket } from "bun";
import { TerminalManager } from "./terminal-manager.js";
import { registerModeMakerRoutes } from "./mode-maker-routes.js";
import { registerEvolutionRoutes } from "./evolution-routes.js";
import { openPath, revealPath, openUrl } from "./system-bridge.js";
import { pathStartsWith, isWin } from "./utils.js";
import { registerExportRoutes } from "./routes/export.js";
import { registerAssetFsRoutes } from "./routes/asset-fs.js";
import { listCheckpoints } from "./shadow-git.js";
import { exportHistory } from "./history-export.js";
import { importHistory } from "./history-import.js";
import { getR2Config, saveR2Config, isR2Configured, shareResult, shareProcess, downloadShare, getApiKeys, saveApiKeys } from "./share.js";
import { getVercelConfig, saveVercelConfig, getVercelStatus, getVercelTeams, deployToVercel, getDeployBinding, saveDeployBinding } from "./vercel.js";
import { getCfPagesConfig, saveCfPagesConfig, getCfPagesStatus, deployCfPages } from "./cloudflare-pages.js";
import { PluginRegistry } from "../core/plugin-registry.js";
import { SettingsManager } from "../core/settings-manager.js";
import { HookBus } from "../core/hook-bus.js";
import { createProxyMiddleware, mergeProxyConfig, type ProxyConfigRef } from "./proxy-middleware.js";
import type { ProxyRoute } from "../core/types/mode-manifest.js";
import { startProxyWatcher, registerSelfWrite, registerSelfDelete } from "./file-watcher.js";
import { mountHandoffRoutes } from "./handoff-routes.js";
import { mountNativeRoutes } from "./native-bridge.js";
import { mountProjectsRoutes } from "./projects-routes.js";
import {
  primeProjectCache,
  revalidateProjectCache,
  shutdownProjectCache,
} from "./projects-cache.js";
import { loadProjectManifest } from "../core/project-loader.js";
import {
  readSessionsFileSync,
  writeSessionsFileSync,
  upsertSession,
  type AnySessionRegistryEntry,
} from "../bin/sessions-registry.js";

const DEFAULT_PORT = 17007;

export interface ServerOptions {
  port?: number;
  workspace: string;
  distDir?: string; // Path to built frontend assets (production mode)
  watchPatterns?: string[]; // Glob patterns for content files (from ModeManifest.viewer)
  initParams?: Record<string, number | string>; // Mode init params (immutable per session)
  externalMode?: { name: string; path: string; type: string }; // External mode info for frontend
  modeBundleDir?: string; // Pre-compiled mode bundle directory (production external modes)
  projectRoot?: string; // Pneuma project root (for mode-maker routes to access builtin modes)
  modeName?: string; // Current mode name (for conditional route registration)
  layout?: "editor" | "app"; // Layout mode from manifest (default: "editor")
  window?: { width: number; height: number }; // Window size preference (app layout + Electron)
  launcherMode?: boolean; // Lightweight launcher server (no workspace, no agent, no watcher)
  debug?: boolean; // Pass --debug to child processes
  forceDev?: boolean; // Pass --dev to child processes
  replayPackagePath?: string; // Path to replay package — pre-loads replay data on server start
  replayMode?: boolean; // Server starts in replay mode (delays agent launch until Continue Work)
  manifestProxy?: Record<string, ProxyRoute>; // Manifest-declared proxy routes
  editing?: boolean; // Initial editing state (from session.json or --viewing flag)
  editingSupported?: boolean; // Mode supports editing ↔ viewing toggle
  backendType?: string; // Backend type for correct instructions file selection (claude-code | codex)
  refreshStrategy?: "auto" | "manual"; // Viewer refresh strategy (default: "auto")

  // ── Pneuma 3.0 Projects: per-session paths ────────────────────────────────
  /**
   * Per-session state directory. For project sessions, this is
   * `<projectRoot>/.pneuma/sessions/<sessionId>`. For quick sessions, omit
   * (defaults to `<workspace>/.pneuma`).
   */
  stateDir?: string;
  /**
   * Per-session home directory (where the agent runs and instructions live).
   * Equals workspace for quick sessions; equals projectRoot for project
   * sessions. Omit for legacy quick-session behavior.
   */
  sessionDir?: string;
  /** Pneuma project session id (uuid). Only set for project sessions. */
  sessionId?: string;
  /**
   * User-facing Pneuma project root (the directory containing
   * `.pneuma/project.json`). Only set for project sessions. Distinct from
   * `projectRoot` above, which is the pneuma-skills repo root used to
   * locate built-in mode manifests.
   */
  pneumaProjectRoot?: string;
}

export async function startServer(options: ServerOptions) {
  const port = options.port ?? DEFAULT_PORT;
  const workspace = resolve(options.workspace);
  const wsBridge = new WsBridge();
  wsBridge.setWorkspace(workspace);
  const terminalManager = new TerminalManager();

  const app = new Hono();

  // Dev mode: allow cross-origin requests from Vite dev server
  app.use("/api/*", cors({ origin: "*" }));

  // ── Shared child-process helpers ────────────────────────────────────────
  // These live above the launcher branch so both launcher mode and per-session
  // mode can share `launchPneumaChild` / `killActiveSession`. The launcher uses
  // them via `/api/launch`; per-session mode uses them via the handoff confirm
  // route mounted by `mountProjectsRoutes`.

  // Track child pneuma processes spawned by /api/launch (launcher mode) or by
  // the handoff confirm route (per-session mode).
  const childProcesses = new Map<number, {
    proc: ReturnType<typeof Bun.spawn>;
    specifier: string;
    workspace: string;
    url: string;
    startedAt: number;
    sessionId?: string;
    project?: string;
  }>();

  /**
   * Launch a pneuma child process and resolve once it logs `[pneuma] ready`.
   * Returns the URL the browser should navigate to, plus the parsed
   * `sessionId` query param (when present) so callers can map sessions back
   * to processes (e.g. for `killActiveSession`).
   *
   * Centralises the spawn+wait logic so `/api/launch` and the handoff
   * confirm route share one path. New consumers should go through this
   * helper rather than re-spawning manually.
   */
  async function launchPneumaChild(params: {
    specifier: string;
    workspace: string;
    initParams?: Record<string, string | number>;
    skipSkill?: boolean;
    backendType?: AgentBackendType;
    replayPackage?: string;
    replaySource?: string;
    sessionName?: string;
    viewing?: boolean;
    project?: string;
    sessionId?: string;
    /**
     * Source-session identity for the `<pneuma:env reason="switched" />`
     * dispatch — only populated when ProjectPanel spawns a sibling click;
     * the launcher's mode-card path leaves them undefined and the child
     * dispatches `reason="opened"` instead.
     */
    fromSessionId?: string;
    fromMode?: string;
    fromDisplayName?: string;
  }): Promise<{ url: string; workspace: string; sessionId: string | null }> {
    const resolvedWorkspace = resolve(params.workspace.replace(/^~/, homedir()));
    mkdirSync(resolvedWorkspace, { recursive: true });

    // Pre-resolve the sessionId for project launches. New project sessions
    // arrive without one (the CLI used to mint via `crypto.randomUUID()`
    // post-spawn), but we need it BEFORE spawn so the config.json write
    // below lands in the correct per-session stateDir. Generating here
    // and threading via `--session-id` keeps the CLI's id resolution
    // deterministic; for non-project (quick) launches we leave it
    // undefined and the CLI's own id flow takes over.
    const launchSessionId = params.sessionId
      ?? (params.project ? crypto.randomUUID() : undefined);

    if (params.initParams && Object.keys(params.initParams).length > 0) {
      // Project sessions read state from `<projectRoot>/.pneuma/sessions/<id>/`,
      // not from `<workspace>/.pneuma/`. Writing to the workspace's `.pneuma/`
      // here would land the auto-filled API keys at the project root, where
      // the per-session agent never looks — so the launch sheet would say
      // "from global keys" but the agent would see no keys at all. Mirror
      // the stateDir resolution from `bin/pneuma.ts` so quick + project
      // sessions both read what we wrote.
      const stateDir = params.project && launchSessionId
        ? join(resolvedWorkspace, ".pneuma", "sessions", launchSessionId)
        : join(resolvedWorkspace, ".pneuma");
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(stateDir, "config.json"), JSON.stringify(params.initParams, null, 2));
    }

    const projectRootResolved = options.projectRoot || resolve(dirname(import.meta.path), "..");
    const pneumaBin = join(projectRootResolved, "bin", "pneuma.ts");
    const args = ["bun", pneumaBin, params.specifier, "--workspace", resolvedWorkspace, "--no-prompt", "--no-open"];
    // Resume-aware backend resolution. When the caller didn't specify a
    // backendType but is reopening an existing project session, read it from
    // that session's `session.json` so a Codex-backed session reopens via
    // Codex (not the default). Mismatched backends would otherwise be caught
    // by `resolveWorkspaceBackendType` and abort the launch.
    let resolvedBackendType = params.backendType;
    if (!resolvedBackendType && params.project && params.sessionId) {
      try {
        const sessionJsonPath = join(
          params.project,
          ".pneuma",
          "sessions",
          params.sessionId,
          "session.json",
        );
        if (existsSync(sessionJsonPath)) {
          const persisted = JSON.parse(readFileSync(sessionJsonPath, "utf-8")) as {
            backendType?: AgentBackendType;
          };
          if (persisted.backendType) resolvedBackendType = persisted.backendType;
        }
      } catch {
        // Best-effort; fall back to the default backend below.
      }
    }
    args.push("--backend", resolvedBackendType || getDefaultBackendType());
    if (params.skipSkill) args.push("--skip-skill");
    if (params.viewing) args.push("--viewing");
    if (params.replayPackage) args.push("--replay", params.replayPackage);
    if (params.replaySource) args.push("--replay-source", params.replaySource);
    if (params.sessionName) args.push("--session-name", params.sessionName);
    if (params.project) args.push("--project", params.project);
    if (launchSessionId) args.push("--session-id", launchSessionId);
    if (params.fromSessionId) args.push("--from-session-id", params.fromSessionId);
    if (params.fromMode) args.push("--from-mode", params.fromMode);
    if (params.fromDisplayName) args.push("--from-display-name", params.fromDisplayName);
    if (options.debug) args.push("--debug");
    if (options.forceDev) args.push("--dev");

    const child = Bun.spawn(args, {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env as Record<string, string> },
    });

    const readyUrl = await new Promise<string>((resolveUrl, reject) => {
      const timeout = setTimeout(() => reject(new Error("Launch timeout (30s)")), 30_000);
      const decoder = new TextDecoder();

      const readStream = async (stream: ReadableStream<Uint8Array>) => {
        const reader = stream.getReader();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            console.log(`[launcher] ${line}`);
            const match = line.match(/\[pneuma\] ready (.+)/);
            if (match) {
              clearTimeout(timeout);
              resolveUrl(match[1]);
              return;
            }
          }
        }
      };

      if (child.stdout) readStream(child.stdout);
      if (child.stderr) {
        const readErr = async (stream: ReadableStream<Uint8Array>) => {
          const reader = stream.getReader();
          const decoder = new TextDecoder();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            console.error(`[launcher:err] ${decoder.decode(value, { stream: true })}`);
          }
        };
        readErr(child.stderr);
      }

      child.exited.then((code) => {
        clearTimeout(timeout);
        if (code !== 0) reject(new Error(`Process exited with code ${code}`));
      });
    });

    // Best-effort sessionId extraction from URL — the child writes
    // `[pneuma] ready http://.../?session=<id>&...`.
    let resolvedSessionId: string | null = null;
    try {
      resolvedSessionId = new URL(readyUrl).searchParams.get("session");
    } catch {
      // URL parsing failure is non-fatal; sessionId tracking just won't
      // be available for this child (kill-by-sessionId becomes a no-op).
    }

    const pid = child.pid;
    childProcesses.set(pid, {
      proc: child,
      specifier: params.specifier,
      workspace: resolvedWorkspace,
      url: readyUrl,
      startedAt: Date.now(),
      sessionId: resolvedSessionId ?? undefined,
      project: params.project,
    });
    child.exited.then(() => {
      childProcesses.delete(pid);
    });

    // The child just wrote a new session subdir under
    // `<project>/.pneuma/sessions/<id>/`. Kick a cache revalidation so
    // the next /api/projects/:id/sessions call picks up the new session
    // immediately instead of waiting on chokidar's `addDir` event. Fire-
    // and-forget — the launch response shouldn't block on the scan.
    if (params.project) {
      revalidateProjectCache(params.project).catch(() => {});
    }

    return { url: readyUrl, workspace: resolvedWorkspace, sessionId: resolvedSessionId };
  }

  /**
   * Terminate the child pneuma process that owns the given sessionId.
   * No-op when no matching process is tracked (e.g. session is not
   * running, or was launched outside the launcher). Errors are logged
   * but never thrown — kill is best-effort.
   *
   * NOTE: this only kills processes spawned by THIS server. A per-session
   * server cannot kill a sibling session because the sibling was spawned
   * by the launcher, not by us. In the typical handoff confirm flow the
   * source is the user's CURRENT session — this server itself — so the
   * source will continue running until the user closes the tab; the
   * `switched_out` history event still records the intent.
   */
  async function killActiveSession(sessionId: string): Promise<void> {
    for (const [pid, info] of childProcesses.entries()) {
      if (info.sessionId === sessionId) {
        try {
          info.proc.kill();
          childProcesses.delete(pid);
        } catch (err) {
          console.warn(`[killActiveSession] ${sessionId} kill failed: ${err}`);
        }
        return;
      }
    }
  }

  // ── Shared route mounters ────────────────────────────────────────────
  // `/api/registry` is needed by BOTH the launcher's marketplace UI and the
  // ProjectPanel's mode-tile grid (the panel calls it on every open). The
  // route's R2 fetch dominated panel render time (~450ms cold), so the
  // response is cached at the server module — first call primes, subsequent
  // calls hit the cache instantly. A 1-minute TTL means a fresh `published`
  // list is never more than a minute behind R2; builtins/local are
  // filesystem-cheap but re-cached together for simplicity.
  const REGISTRY_URL = "https://pneuma-storage.vibecoding.icu";
  const REGISTRY_TTL_MS = 60_000;

  interface RegistryResponse {
    builtins: Array<{
      name: string;
      displayName: string;
      description?: string;
      icon?: string;
      version: string;
      type: "builtin";
      hasInitParams?: boolean;
      showcase?: { tagline?: string; hero?: string; highlights?: Array<{ title: string; description: string; media: string; mediaType?: string }> };
      inspiredBy?: { name: string; url: string };
    }>;
    published: Array<{ name: string; displayName: string; description?: string; version: string; publishedAt: string; archiveUrl: string; icon?: string }>;
    local: Array<{ name: string; displayName: string; description?: string; version: string; path: string; icon?: string }>;
  }

  let registryCache: { value: RegistryResponse; fetchedAt: number } | null = null;
  let registryInflight: Promise<RegistryResponse> | null = null;

  const buildRegistry = async (): Promise<RegistryResponse> => {
    const { parseManifestTs } = await import("../core/utils/manifest-parser.js");
    const projectRoot = options.projectRoot || resolve(dirname(import.meta.path), "..");

    const builtinNames = ["webcraft", "kami", "slide", "doc", "draw", "diagram", "illustrate", "remotion", "gridboard", "clipcraft"];
    const builtins = builtinNames.map((name) => {
      const manifestPath = join(projectRoot, "modes", name, "manifest.ts");
      let parsed: ReturnType<typeof parseManifestTs> = {};
      try { parsed = parseManifestTs(readFileSync(manifestPath, "utf-8")); } catch { }
      let showcase: RegistryResponse["builtins"][number]["showcase"] | undefined;
      try {
        const showcasePath = join(projectRoot, "modes", name, "showcase", "showcase.json");
        if (existsSync(showcasePath)) {
          showcase = JSON.parse(readFileSync(showcasePath, "utf-8"));
        }
      } catch { }
      return {
        name,
        displayName: parsed.displayName || name,
        description: parsed.description || "",
        icon: parsed.icon,
        version: "builtin",
        type: "builtin" as const,
        ...((name === "slide" || name === "illustrate" || name === "kami") ? { hasInitParams: true } : {}),
        ...(showcase ? { showcase } : {}),
        ...(parsed.inspiredBy ? { inspiredBy: parsed.inspiredBy } : {}),
      };
    });

    let published: RegistryResponse["published"] = [];
    try {
      const res = await fetch(`${REGISTRY_URL}/registry/index.json`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const data = await res.json() as { modes?: typeof published };
        published = data.modes || [];
      }
    } catch { }

    const modesDir = join(homedir(), ".pneuma", "modes");
    const local: RegistryResponse["local"] = [];
    try {
      if (existsSync(modesDir)) {
        const entries = readdirSync(modesDir);
        for (const entry of entries) {
          const entryPath = join(modesDir, entry);
          if (!statSync(entryPath).isDirectory()) continue;
          const manifestFile = ["manifest.ts", "manifest.js"].find((f) => existsSync(join(entryPath, f)));
          if (!manifestFile) continue;
          try {
            const content = readFileSync(join(entryPath, manifestFile), "utf-8");
            const parsed = parseManifestTs(content);
            local.push({
              name: parsed.name || entry,
              displayName: parsed.displayName || entry,
              description: parsed.description,
              icon: parsed.icon,
              version: parsed.version || "local",
              path: entryPath,
            });
          } catch { }
        }
      }
    } catch { }

    return { builtins, published, local };
  };

  /**
   * SWR registry getter. If cache fresh (< TTL) → return immediately. If
   * stale → return stale + revalidate in background. If empty → block
   * until first fetch (one-time cost). Concurrent calls dedupe via the
   * in-flight Promise.
   */
  const getRegistry = async (): Promise<RegistryResponse> => {
    const now = Date.now();
    if (registryCache && now - registryCache.fetchedAt < REGISTRY_TTL_MS) {
      return registryCache.value;
    }
    if (registryCache) {
      // Stale → return stale + revalidate in background
      if (!registryInflight) {
        registryInflight = buildRegistry()
          .then((value) => {
            registryCache = { value, fetchedAt: Date.now() };
            registryInflight = null;
            return value;
          })
          .catch((err) => {
            console.warn(`[registry-cache] revalidate failed: ${err}`);
            registryInflight = null;
            return registryCache!.value;
          });
      }
      return registryCache.value;
    }
    // First call — wait for build, dedupe concurrent first-callers
    if (!registryInflight) {
      registryInflight = buildRegistry()
        .then((value) => {
          registryCache = { value, fetchedAt: Date.now() };
          registryInflight = null;
          return value;
        })
        .catch((err) => {
          registryInflight = null;
          throw err;
        });
    }
    return registryInflight;
  };

  // Prime in the background so the first /api/registry call is instant.
  void getRegistry().catch(() => { /* already logged */ });

  const mountRegistryRoute = (target: Hono) => {
    target.get("/api/registry", async (c) => {
      const data = await getRegistry();
      return c.json(data);
    });
  };

  // ── Launcher Mode (lightweight — no workspace, no agent, no watcher) ────
  if (options.launcherMode) {
    const pneumaHome = join(homedir(), ".pneuma");
    const settingsManager = new SettingsManager(pneumaHome);
    settingsManager.migrateIfNeeded();
    const hookBus = new HookBus();
    const pluginRegistry = new PluginRegistry({
      builtinDir: join(import.meta.dir, "..", "plugins"),
      externalDir: join(pneumaHome, "plugins"),
      settingsManager,
      hookBus,
    });

    mountRegistryRoute(app);

    app.get("/api/backends", (c) => {
      const descriptors = getBackendDescriptors();
      const availability = detectBackendAvailability();
      const backends = descriptors.map((desc) => {
        const avail = availability.find((a) => a.type === desc.type);
        return { ...desc, available: avail?.available ?? false, reason: avail?.reason };
      });
      return c.json({ backends, defaultBackendType: getDefaultBackendType() });
    });

    // Install a mode from a remote source (url tar.gz or github:user/repo).
    // Reuses the CLI `pneuma mode add` plumbing so the UI install button, the
    // pneuma://mode URL schema handler, and the CLI all land bits in exactly
    // the same cache location under ~/.pneuma/modes/<name>/.
    app.post("/api/modes/install", async (c) => {
      try {
        const body = await c.req.json<{ source?: string; url?: string }>().catch(() => ({} as { source?: string; url?: string }));
        const source = (body.source ?? body.url ?? "").trim();
        if (!source) {
          return c.json({ error: "source is required (URL to a .tar.gz or github:user/repo)" }, 400);
        }
        const isHttpsTarball = source.startsWith("https://") && source.endsWith(".tar.gz");
        const isGithub = source.startsWith("github:");
        if (!isHttpsTarball && !isGithub) {
          return c.json({ error: "Only https://...tar.gz and github:user/repo sources are supported" }, 400);
        }

        const projectRoot = options.projectRoot || resolve(dirname(import.meta.path), "..");
        const { resolveMode } = await import("../core/mode-resolver.js");
        const resolved = await resolveMode(source, projectRoot);
        if (resolved.type === "builtin") {
          return c.json({ error: `"${resolved.name}" is a built-in mode — already available.` }, 400);
        }

        // Read back the installed manifest so the UI can show display name + description
        // without needing a second roundtrip to the directory listing.
        let displayName = resolved.name;
        let description: string | undefined;
        let version = "local";
        let icon: string | undefined;
        try {
          const manifestFile = ["manifest.ts", "manifest.js"].find((f) => existsSync(join(resolved.path, f)));
          if (manifestFile) {
            const { parseManifestTs } = await import("../core/utils/manifest-parser.js");
            const content = readFileSync(join(resolved.path, manifestFile), "utf-8");
            const parsed = parseManifestTs(content);
            displayName = parsed.displayName || resolved.name;
            description = parsed.description;
            version = parsed.version || "local";
            icon = parsed.icon;
          }
        } catch { /* manifest parse optional */ }

        return c.json({
          ok: true,
          name: resolved.name,
          displayName,
          description,
          version,
          icon,
          path: resolved.path,
          source,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return c.json({ error: message }, 500);
      }
    });

    // Delete a local mode
    app.delete("/api/modes/:name", async (c) => {
      const name = c.req.param("name");
      if (!name || name.includes("..") || name.includes("/") || name.includes("\\")) {
        return c.json({ error: "Invalid mode name" }, 400);
      }
      const modesDir = join(homedir(), ".pneuma", "modes");
      const targetDir = join(modesDir, name);
      // Safety: resolved path must be inside modesDir
      if (!pathStartsWith(resolve(targetDir), resolve(modesDir) + sep)) {
        return c.json({ error: "Invalid mode name" }, 400);
      }
      if (!existsSync(targetDir)) {
        return c.json({ error: "Mode not found" }, 404);
      }
      const { rmSync } = await import("node:fs");
      rmSync(targetDir, { recursive: true, force: true });
      return c.json({ ok: true });
    });

    // Serve mode showcase assets (images, gifs, videos)
    app.get("/api/modes/:name/showcase/*", async (c) => {
      const name = c.req.param("name");
      const assetPath = c.req.path.split("/showcase/").slice(1).join("/showcase/");
      if (!name || !assetPath) {
        return c.json({ error: "Invalid path" }, 400);
      }
      const projectRoot = options.projectRoot || resolve(dirname(import.meta.path), "..");
      // Check builtin modes first, then local modes
      const builtinShowcase = resolve(join(projectRoot, "modes", name, "showcase"));
      const localShowcase = resolve(join(homedir(), ".pneuma", "modes", name, "showcase"));
      let fullPath = resolve(join(builtinShowcase, assetPath));
      // Path containment: resolved path must stay inside one of the showcase dirs
      if (!pathStartsWith(fullPath, builtinShowcase + sep)) {
        return c.json({ error: "Invalid path" }, 400);
      }
      if (!existsSync(fullPath)) {
        const localFull = resolve(join(localShowcase, assetPath));
        if (pathStartsWith(localFull, localShowcase + sep) && existsSync(localFull)) {
          fullPath = localFull;
        } else {
          return c.notFound();
        }
      }
      // Determine content type
      const ext = assetPath.split(".").pop()?.toLowerCase();
      const contentTypes: Record<string, string> = {
        png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
        webp: "image/webp", svg: "image/svg+xml", mp4: "video/mp4", webm: "video/webm",
      };
      const contentType = contentTypes[ext || ""] || "application/octet-stream";
      try {
        const file = Bun.file(fullPath);
        return new Response(file, { headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=3600" } });
      } catch {
        return c.notFound();
      }
    });

    // List recent sessions
    //
    // The launcher's "Recent Sessions" surface shows quick (workspace-rooted)
    // sessions — project sessions live under the separate Recent Projects
    // section. So we filter to `kind === "quick"` here. Reads the new
    // `{projects, sessions}` schema via `readSessionsFileSync` which also
    // auto-upgrades the legacy 2.x array format.
    app.get("/api/sessions", (c) => {
      const registryPath = join(homedir(), ".pneuma", "sessions.json");
      const data = readSessionsFileSync(registryPath);
      let quickSessions = data.sessions.filter(
        (s): s is Extract<AnySessionRegistryEntry, { kind: "quick" }> => s.kind === "quick"
      );
      quickSessions = quickSessions.map((session) => ({
        ...session,
        backendType: session.backendType || getDefaultBackendType(),
      }));
      // Filter out sessions whose workspace no longer exists
      quickSessions = quickSessions.filter((s) => existsSync(s.workspace));
      // Sort by lastAccessed descending
      quickSessions.sort((a, b) => b.lastAccessed - a.lastAccessed);
      // Check for thumbnails
      const sessionsWithThumbs = quickSessions.map((s) => ({
        ...s,
        hasThumbnail: existsSync(join(s.workspace, ".pneuma", "thumbnail.png")),
        hasReplayData: existsSync(join(s.workspace, ".pneuma", "shadow.git", "HEAD"))
          && existsSync(join(s.workspace, ".pneuma", "checkpoints.jsonl"))
          && (() => {
            try {
              const content = readFileSync(join(s.workspace, ".pneuma", "checkpoints.jsonl"), "utf-8").trim();
              return content.length > 0;
            } catch { return false; }
          })(),
      }));
      return c.json({ sessions: sessionsWithThumbs, homeDir: homedir() });
    });

    // Serve session thumbnail — validate workspace against session registry
    app.get("/api/sessions/thumbnail", (c) => {
      const workspace = c.req.query("workspace");
      if (!workspace) return c.json({ error: "Missing workspace" }, 400);

      // Validate: workspace must be a known registered quick-session workspace.
      // Project sessions don't have a `workspace` field; they're served via
      // `/api/projects/...` instead.
      const registryPath = join(homedir(), ".pneuma", "sessions.json");
      const data = readSessionsFileSync(registryPath);
      const knownWorkspaces = data.sessions
        .filter((s): s is Extract<AnySessionRegistryEntry, { kind: "quick" }> => s.kind === "quick")
        .map((s) => resolve(s.workspace));
      const resolvedWorkspace = resolve(workspace);
      if (!knownWorkspaces.includes(resolvedWorkspace)) {
        return c.json({ error: "Unknown workspace" }, 403);
      }

      const thumbPath = join(resolvedWorkspace, ".pneuma", "thumbnail.png");
      // Extra safety: resolved path must stay inside the workspace
      if (!pathStartsWith(thumbPath, resolvedWorkspace)) {
        return c.json({ error: "Invalid path" }, 403);
      }
      try {
        if (!existsSync(thumbPath)) return c.notFound();
        const file = Bun.file(thumbPath);
        return new Response(file, {
          headers: {
            "Content-Type": "image/png",
            "Cache-Control": "no-cache",
          },
        });
      } catch {
        return c.notFound();
      }
    });

    // Delete a session record
    app.delete("/api/sessions/:id", (c) => {
      const id = decodeURIComponent(c.req.param("id"));
      const registryPath = join(homedir(), ".pneuma", "sessions.json");
      const data = readSessionsFileSync(registryPath);
      const next = {
        projects: data.projects,
        sessions: data.sessions.filter((s) => s.id !== id),
      };
      try {
        writeSessionsFileSync(registryPath, next);
      } catch { }
      return c.json({ ok: true });
    });

    // Rename a session
    app.patch("/api/sessions/:id", async (c) => {
      const id = decodeURIComponent(c.req.param("id"));
      const { sessionName } = await c.req.json<{ sessionName: string }>();
      if (!sessionName || typeof sessionName !== "string") {
        return c.json({ error: "sessionName is required" }, 400);
      }
      const registryPath = join(homedir(), ".pneuma", "sessions.json");
      const data = readSessionsFileSync(registryPath);
      const idx = data.sessions.findIndex((s) => s.id === id);
      if (idx < 0) return c.json({ error: "Session not found" }, 404);
      const trimmed = sessionName.trim();
      const updatedSessions = data.sessions.map((s, i) =>
        i === idx ? ({ ...s, sessionName: trimmed } as AnySessionRegistryEntry) : s
      );
      try {
        writeSessionsFileSync(registryPath, { projects: data.projects, sessions: updatedSessions });
      } catch { }
      return c.json({ ok: true });
    });

    // Browse directories for workspace path picker
    app.get("/api/browse-dirs", (c) => {
      const raw = (c.req.query("path") || "").trim() || homedir();
      let target = resolve(raw.replace(/^~/, homedir()));
      // Walk up to nearest existing directory
      let walked = false;
      while (!existsSync(target) && target !== dirname(target)) {
        target = dirname(target);
        walked = true;
      }
      try {
        const entries = readdirSync(target, { withFileTypes: true });
        const dirs = entries
          .filter((e) => e.isDirectory() && !e.name.startsWith("."))
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((e) => ({ name: e.name, path: join(target, e.name) }));
        const parent = dirname(target);
        return c.json({ current: target, parent: parent !== target ? parent : null, dirs, ...(walked ? { resolved: true } : {}) });
      } catch {
        return c.json({ current: target, parent: dirname(target), dirs: [], error: "Cannot read directory" });
      }
    });

    // Check if a workspace already has a Pneuma session
    app.get("/api/workspace-check", (c) => {
      const raw = (c.req.query("path") || "").trim();
      if (!raw) return c.json({ hasSession: false });
      const target = resolve(raw.replace(/^~/, homedir()));
      const sessionPath = join(target, ".pneuma", "session.json");
      const configPath = join(target, ".pneuma", "config.json");
      if (!existsSync(sessionPath)) return c.json({ hasSession: false });
      try {
        const session = JSON.parse(readFileSync(sessionPath, "utf-8"));
        let config: Record<string, string | number> = {};
        try { config = JSON.parse(readFileSync(configPath, "utf-8")); } catch { }
        return c.json({
          hasSession: true,
          mode: session.mode,
          backendType: session.backendType || getDefaultBackendType(),
          config,
        });
      } catch {
        return c.json({ hasSession: false });
      }
    });

    // Check if a session's skill needs updating
    //
    // Accepts either:
    //   - workspace (legacy quick session): reads from `<workspace>/.pneuma/`
    //   - sessionDir (project session): reads from the per-session state dir
    //     (e.g. `<projectRoot>/.pneuma/sessions/<sessionId>`). When provided,
    //     sessionDir wins over workspace as the state location.
    app.post("/api/launch/skill-check", async (c) => {
      const { specifier, workspace: rawWorkspace, sessionDir: rawSessionDir } = await c.req.json<{
        specifier: string;
        workspace: string;
        sessionDir?: string;
      }>();
      try {
        const resolvedWorkspace = resolve(rawWorkspace.replace(/^~/, homedir()));
        const stateDir = rawSessionDir
          ? resolve(rawSessionDir.replace(/^~/, homedir()))
          : join(resolvedWorkspace, ".pneuma");
        const { resolveMode } = await import("../core/mode-resolver.js");
        const projectRoot = options.projectRoot || resolve(dirname(import.meta.path), "..");
        const resolved = await resolveMode(specifier, projectRoot);

        if (resolved.type !== "builtin") {
          const { registerExternalMode } = await import("../core/mode-loader.js");
          registerExternalMode(resolved.name, resolved.path);
        }

        const { loadModeManifest } = await import("../core/mode-loader.js");
        const manifest = await loadModeManifest(resolved.name);
        const currentVersion = manifest.version || "unknown";

        // Read installed version
        let installedVersion = "";
        try {
          const data = JSON.parse(readFileSync(join(stateDir, "skill-version.json"), "utf-8"));
          installedVersion = data.version || "";
        } catch { }

        // Read dismissed version
        let dismissedVersion = "";
        try {
          const data = JSON.parse(readFileSync(join(stateDir, "skill-dismissed.json"), "utf-8"));
          dismissedVersion = data.version || "";
        } catch { }

        const needsUpdate = installedVersion !== "" && installedVersion !== currentVersion;
        const dismissed = needsUpdate && dismissedVersion === currentVersion;

        // Extract changelog highlights for the version range. Newest first.
        // Skipped silently when the manifest has no `changelog` field — the
        // prompt simply renders without highlights and falls back to the
        // version-only message it always showed.
        type Highlight = { version: string; bullets: string[] };
        let highlights: Highlight[] = [];
        if (needsUpdate && manifest.changelog) {
          const cmp = (a: string, b: string) => {
            const ap = a.split(".").map((n) => parseInt(n, 10) || 0);
            const bp = b.split(".").map((n) => parseInt(n, 10) || 0);
            const len = Math.max(ap.length, bp.length);
            for (let i = 0; i < len; i++) {
              const av = ap[i] ?? 0;
              const bv = bp[i] ?? 0;
              if (av !== bv) return av - bv;
            }
            return 0;
          };
          highlights = Object.entries(manifest.changelog)
            .filter(([v]) => cmp(v, installedVersion) > 0 && cmp(v, currentVersion) <= 0)
            .sort(([a], [b]) => cmp(b, a))
            .map(([version, bullets]) => ({ version, bullets }));
        }

        // Repo-level changelog link. Builtin modes share the project's
        // CHANGELOG.md on GitHub; external modes may override later via a
        // manifest field but for now the project link is the safe default.
        const changelogUrl = "https://github.com/pandazki/pneuma-skills/blob/main/CHANGELOG.md";

        return c.json({ needsUpdate, currentVersion, installedVersion, dismissed, highlights, changelogUrl });
      } catch (err) {
        // Can't check — just let them launch
        return c.json({ needsUpdate: false, currentVersion: "", installedVersion: "", dismissed: false });
      }
    });

    // Dismiss a skill update for a specific version. Accepts an optional
    // sessionDir for project sessions; falls back to <workspace>/.pneuma when
    // omitted (legacy quick-session behavior).
    app.post("/api/launch/skill-dismiss", async (c) => {
      const { workspace: rawWorkspace, sessionDir: rawSessionDir, version } = await c.req.json<{
        workspace: string;
        sessionDir?: string;
        version: string;
      }>();
      try {
        const resolvedWorkspace = resolve(rawWorkspace.replace(/^~/, homedir()));
        const dir = rawSessionDir
          ? resolve(rawSessionDir.replace(/^~/, homedir()))
          : join(resolvedWorkspace, ".pneuma");
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "skill-dismissed.json"), JSON.stringify({ version }));
      } catch { }
      return c.json({ ok: true });
    });

    app.post("/api/launch/prepare", async (c) => {
      const { specifier } = await c.req.json<{ specifier: string }>();
      try {
        // Resolve mode → load manifest → return initParams
        const { resolveMode } = await import("../core/mode-resolver.js");
        const projectRoot = options.projectRoot || resolve(dirname(import.meta.path), "..");
        const resolved = await resolveMode(specifier, projectRoot);

        if (resolved.type !== "builtin") {
          const { registerExternalMode } = await import("../core/mode-loader.js");
          registerExternalMode(resolved.name, resolved.path);
        }

        const { loadModeManifest } = await import("../core/mode-loader.js");
        const manifest = await loadModeManifest(resolved.name);

        // Auto-fill initParams defaults from stored API keys
        // Match by: exact name, UPPER_SNAKE_CASE → camelCase, camelCase → UPPER_SNAKE_CASE
        const storedKeys = getApiKeys();
        const camelFromSnake = (s: string) =>
          s.toLowerCase().replace(/_([a-z])/g, (_: string, c: string) => c.toUpperCase());
        const snakeFromCamel = (s: string) =>
          s.replace(/[A-Z]/g, (c: string) => `_${c}`).toUpperCase();

        const params = (manifest.init?.params || []).map((p: any) => {
          let matchedValue: string | null = null;

          if (storedKeys[p.name]) {
            matchedValue = storedKeys[p.name];
          } else {
            for (const [storedName, storedValue] of Object.entries(storedKeys)) {
              if (camelFromSnake(storedName) === p.name || snakeFromCamel(p.name) === storedName) {
                matchedValue = storedValue;
                break;
              }
            }
          }

          if (matchedValue) {
            // Return actual value for launch, but mark as auto-filled with masked preview
            const masked = matchedValue.slice(0, 4) + "****" + matchedValue.slice(-4);
            return { ...p, defaultValue: matchedValue, autoFilled: true, maskedPreview: masked };
          }
          return p;
        });

        return c.json({
          name: resolved.name,
          displayName: manifest.displayName,
          initParams: params,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return c.json({ error: message }, 400);
      }
    });

    app.post("/api/launch", async (c) => {
      const body = await c.req.json<{
        specifier: string;
        workspace: string;
        initParams?: Record<string, string | number>;
        skipSkill?: boolean;
        backendType?: AgentBackendType;
        replayPackage?: string;
        replaySource?: string;
        sessionName?: string;
        viewing?: boolean;
        project?: string;
        sessionId?: string;
        from_session_id?: string;
        from_mode?: string;
        from_display_name?: string;
      }>();
      try {
        const result = await launchPneumaChild({
          specifier: body.specifier,
          workspace: body.workspace,
          initParams: body.initParams,
          skipSkill: body.skipSkill,
          backendType: body.backendType,
          replayPackage: body.replayPackage,
          replaySource: body.replaySource,
          sessionName: body.sessionName,
          viewing: body.viewing,
          project: body.project,
          sessionId: body.sessionId,
          fromSessionId: body.from_session_id,
          fromMode: body.from_mode,
          fromDisplayName: body.from_display_name,
        });
        return c.json({ url: result.url, workspace: result.workspace, mode: body.specifier });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return c.json({ error: message }, 500);
      }
    });

    // List running child processes
    app.get("/api/processes/children", (c) => {
      const processes = Array.from(childProcesses.entries()).map(([pid, info]) => ({
        pid,
        specifier: info.specifier,
        workspace: info.workspace,
        url: info.url,
        startedAt: info.startedAt,
      }));
      return c.json({ processes });
    });

    // Kill a specific child process
    app.post("/api/processes/children/:pid/kill", (c) => {
      const pid = parseInt(c.req.param("pid"), 10);
      const entry = childProcesses.get(pid);
      if (!entry) {
        return c.json({ error: "Process not found" }, 404);
      }
      try {
        entry.proc.kill();
        childProcesses.delete(pid);
      } catch { }
      return c.json({ ok: true });
    });

    // R2 Configuration
    app.get("/api/r2/status", (c) => {
      const config = getR2Config();
      return c.json({
        configured: !!config,
        publicUrl: config?.publicUrl ?? null,
      });
    });

    app.get("/api/r2/config", (c) => {
      const config = getR2Config();
      if (!config) return c.json({ configured: false });
      return c.json({
        configured: true,
        accountId: config.accountId,
        bucket: config.bucket,
        publicUrl: config.publicUrl,
        // Don't expose secrets
        accessKeyId: config.accessKeyId.slice(0, 6) + "***",
        secretAccessKey: "***",
      });
    });

    app.post("/api/r2/config", async (c) => {
      try {
        const body = await c.req.json<{
          accountId: string;
          accessKeyId: string;
          secretAccessKey: string;
          bucket: string;
          publicUrl: string;
        }>();
        saveR2Config({
          accountId: body.accountId,
          accessKeyId: body.accessKeyId,
          secretAccessKey: body.secretAccessKey,
          bucket: body.bucket,
          publicUrl: body.publicUrl.replace(/\/$/, ""),
        });
        return c.json({ ok: true });
      } catch (err: any) {
        return c.json({ error: err.message }, 500);
      }
    });

    // ── Plugin System Routes ────────────────────────────────────────────────

    app.get("/api/plugins", async (c) => {
      const freshPlugins = await pluginRegistry.discover();
      const plugins = freshPlugins.map((p) => ({
        name: p.name,
        displayName: p.displayName,
        description: p.description,
        version: p.version,
        builtin: p.builtin ?? false,
        scope: p.scope,
        settings: p.settings ? Object.keys(p.settings) : [],
        settingsSchema: p.settings ?? {},
      }));
      return c.json({ plugins });
    });

    app.get("/api/plugin-settings/:name", async (c) => {
      const name = c.req.param("name");
      const freshPlugins = await pluginRegistry.discover();
      return c.json({
        enabled: (() => {
          const entry = settingsManager.getAll().plugins[name];
          if (entry !== undefined) return entry.enabled !== false;
          const manifest = freshPlugins.find(p => p.name === name);
          if (manifest?.builtin) return manifest.defaultEnabled !== false;
          return settingsManager.isEnabled(name);
        })(),
        config: settingsManager.getPluginConfig(name),
      });
    });

    app.post("/api/plugin-settings/:name", async (c) => {
      const name = c.req.param("name");
      const body = await c.req.json<{ enabled?: boolean; config?: Record<string, unknown> }>();
      if (body.enabled !== undefined) settingsManager.setEnabled(name, body.enabled);
      if (body.config) {
        settingsManager.updateConfig(name, body.config);
        // Sync to legacy config files for deploy plugins (always sync, including clears)
        if (name === "vercel-deploy") {
          const { saveVercelConfig } = await import("./vercel.js");
          saveVercelConfig({ token: (body.config.token as string) ?? "", teamId: (body.config.teamId as string) || null });
        }
        if (name === "cf-pages-deploy") {
          const { saveCfPagesConfig } = await import("./cloudflare-pages.js");
          saveCfPagesConfig({ apiToken: (body.config.token as string) ?? "", accountId: (body.config.accountId as string) ?? "" });
        }
      }
      return c.json({ ok: true });
    });

    // Keep Vercel status/teams/config routes for backward compatibility during transition
    // These delegate to the same underlying functions
    // Vercel Configuration
    app.get("/api/vercel/status", async (c) => {
      const status = await getVercelStatus();
      return c.json(status);
    });

    app.get("/api/vercel/config", (c) => {
      const config = getVercelConfig();
      if (!config) return c.json({ configured: false });
      return c.json({
        configured: true,
        token: config.token.slice(0, 6) + "***",
        teamId: config.teamId ?? null,
      });
    });

    app.post("/api/vercel/config", async (c) => {
      try {
        const body = await c.req.json<{ token: string; teamId?: string | null }>();
        saveVercelConfig({ token: body.token, teamId: body.teamId ?? null });
        return c.json({ ok: true });
      } catch (err: any) {
        return c.json({ error: err.message }, 500);
      }
    });

    app.get("/api/vercel/teams", async (c) => {
      const teams = await getVercelTeams();
      return c.json({ teams });
    });

    // Cloudflare Pages Configuration
    app.get("/api/cf-pages/status", async (c) => {
      const status = await getCfPagesStatus();
      return c.json(status);
    });

    app.get("/api/cf-pages/config", (c) => {
      const config = getCfPagesConfig();
      if (!config) return c.json({ configured: false });
      return c.json({
        configured: true,
        accountId: config.accountId,
        apiToken: config.apiToken.slice(0, 6) + "***",
      });
    });

    app.post("/api/cf-pages/config", async (c) => {
      try {
        const body = await c.req.json<{ apiToken: string; accountId: string }>();
        saveCfPagesConfig({ apiToken: body.apiToken, accountId: body.accountId });
        return c.json({ ok: true });
      } catch (err: any) {
        return c.json({ error: err.message }, 500);
      }
    });

    // API Keys
    app.get("/api/keys", (c) => {
      const keys = getApiKeys();
      // Mask values for display
      const masked: Record<string, string> = {};
      for (const [name, value] of Object.entries(keys)) {
        masked[name] = value.slice(0, 8) + "***";
      }
      return c.json({ keys: masked });
    });

    app.post("/api/keys", async (c) => {
      try {
        const body = await c.req.json<{ keys: Record<string, string> }>();
        saveApiKeys(body.keys);
        return c.json({ ok: true });
      } catch (err: any) {
        return c.json({ error: err.message }, 500);
      }
    });

    app.put("/api/keys/:name", async (c) => {
      const name = c.req.param("name");
      const body = await c.req.json<{ value: string }>();
      const keys = getApiKeys();
      keys[name] = body.value;
      saveApiKeys(keys);
      return c.json({ ok: true });
    });

    app.delete("/api/keys/:name", (c) => {
      const name = c.req.param("name");
      const keys = getApiKeys();
      delete keys[name];
      saveApiKeys(keys);
      return c.json({ ok: true });
    });

    // Import shared content
    // Shared import logic: processes a local archive file
    async function processImportArchive(archivePath: string, workspaceOverride?: string, cleanupArchive = false) {
      const checkProc = Bun.spawn(["tar", "tzf", archivePath], { stdout: "pipe", stderr: "ignore" });
      const listing = await new Response(checkProc.stdout).text();
      const isProcess = listing.includes("manifest.json") && listing.includes("messages.jsonl");

      const targetDir = workspaceOverride
        ? resolve(workspaceOverride.replace(/^~/, homedir()))
        : join(homedir(), "pneuma-projects", `import-${new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 13)}`);
      mkdirSync(targetDir, { recursive: true });

      const stageDir = join(tmpdir(), `pneuma-import-stage-${Date.now()}`);
      mkdirSync(stageDir, { recursive: true });
      await Bun.spawn(["tar", "xzf", archivePath, "-C", stageDir], { stdout: "ignore" }).exited;

      let mode = "webcraft";
      let displayName = "Imported";
      if (isProcess) {
        try {
          const manifest = JSON.parse(readFileSync(join(stageDir, "manifest.json"), "utf-8"));
          mode = manifest.metadata?.mode || mode;
          displayName = manifest.metadata?.title || displayName;

          const bundlePath = join(stageDir, "repo.bundle");
          if (existsSync(bundlePath)) {
            const bareRepo = join(stageDir, ".bare-repo");
            await Bun.spawn(["git", "clone", "--bare", bundlePath, bareRepo], { stdout: "ignore", stderr: "ignore" }).exited;
            const headProc = Bun.spawn(["git", `--git-dir=${bareRepo}`, "rev-parse", "HEAD"], { stdout: "pipe", stderr: "ignore" });
            const headHash = (await new Response(headProc.stdout).text()).trim();
            if (headHash) {
              const archive = Bun.spawn(["git", `--git-dir=${bareRepo}`, "archive", headHash], { stdout: "pipe", stderr: "ignore" });
              const extract = Bun.spawn(["tar", "x", "-C", targetDir], { stdin: archive.stdout, stdout: "ignore", stderr: "ignore" });
              await extract.exited;
            }
          }

          const pneumaDir = join(targetDir, ".pneuma");
          mkdirSync(pneumaDir, { recursive: true });
          const replayDir = join(pneumaDir, "replay");
          mkdirSync(replayDir, { recursive: true });
          const { copyFileSync } = await import("node:fs");
          try { copyFileSync(join(stageDir, "manifest.json"), join(replayDir, "manifest.json")); } catch {}
          try { copyFileSync(join(stageDir, "messages.jsonl"), join(replayDir, "messages.jsonl")); } catch {}
          try { copyFileSync(join(stageDir, "repo.bundle"), join(replayDir, "repo.bundle")); } catch {}

          writeFileSync(join(pneumaDir, "session.json"), JSON.stringify({
            sessionId: crypto.randomUUID(),
            mode,
            backendType: manifest.metadata?.backendType || "claude-code",
            createdAt: Date.now(),
            importedFrom: manifest.metadata?.id,
            hasReplay: true,
          }));
        } catch (err) {
          console.warn("[import] Failed to restore process package:", err);
        }
      } else {
        await Bun.spawn(["sh", "-c", `cp -a "${stageDir}"/. "${targetDir}"/`], { stdout: "ignore", stderr: "ignore" }).exited;
        try {
          const session = JSON.parse(readFileSync(join(targetDir, ".pneuma", "session.json"), "utf-8"));
          mode = session.mode || mode;
        } catch {}
        try {
          const snap = JSON.parse(readFileSync(join(targetDir, ".pneuma-snapshot.json"), "utf-8"));
          mode = snap.mode || mode;
        } catch {}
      }

      try { const { rmSync: rm } = await import("node:fs"); rm(stageDir, { recursive: true, force: true }); } catch {}
      if (cleanupArchive) { try { const { unlinkSync } = await import("node:fs"); unlinkSync(archivePath); } catch {} }

      const registryPath = join(homedir(), ".pneuma", "sessions.json");
      const data = readSessionsFileSync(registryPath);
      const sessionId = `${targetDir}::${mode}`;
      const importedEntry: AnySessionRegistryEntry = {
        id: sessionId,
        kind: "quick",
        mode,
        displayName: `${displayName} (imported)`,
        workspace: targetDir,
        sessionDir: targetDir,
        backendType: getDefaultBackendType(),
        lastAccessed: Date.now(),
      };
      writeSessionsFileSync(registryPath, upsertSession(data, importedEntry));

      const replayPackagePath = isProcess ? join(targetDir, ".pneuma", "replay") : undefined;
      return { ok: true, type: isProcess ? "process" : "result", path: targetDir, mode, displayName, replayPackagePath };
    }

    app.post("/api/import", async (c) => {
      try {
        const body = await c.req.json<{ url: string; workspace?: string }>();
        const downloadPath = await downloadShare(body.url);
        const result = await processImportArchive(downloadPath, body.workspace, true);
        return c.json(result);
      } catch (err: any) {
        return c.json({ error: err.message }, 500);
      }
    });

    app.post("/api/import/upload", async (c) => {
      try {
        const formData = await c.req.formData();
        const file = formData.get("file") as File | null;
        const workspace = formData.get("workspace") as string | null;
        if (!file) return c.json({ error: "No file provided" }, 400);

        // Save uploaded file to temp
        const tempPath = join(tmpdir(), `pneuma-upload-${Date.now()}-${file.name}`);
        const buf = await file.arrayBuffer();
        writeFileSync(tempPath, Buffer.from(buf));

        const result = await processImportArchive(tempPath, workspace || undefined, true);
        return c.json(result);
      } catch (err: any) {
        return c.json({ error: err.message }, 500);
      }
    });

    // ── Project routes API (also available in launcher mode) ─────────────
    mountProjectsRoutes(app, {
      homeDir: homedir(),
    });

    // Prime the per-project cache for every known project so the launcher's
    // "Recent Projects" grid renders from cache on first paint. The first
    // /api/projects call that arrives before priming finishes still works
    // (it falls back to a synchronous SWR scan); priming just lets the
    // common case skip that one-time cost. Wrapped so a malformed registry
    // doesn't block server start.
    try {
      const registryData = readSessionsFileSync(
        join(homedir(), ".pneuma", "sessions.json"),
      );
      for (const p of registryData.projects) {
        // Don't await — the goal is to populate the cache in the background
        // while the server keeps coming up.
        primeProjectCache(p.root).catch((err) => {
          console.warn(`[projects-cache] prime failed for ${p.root}: ${err}`);
        });
      }
    } catch (err) {
      console.warn(`[projects-cache] prime-on-start failed: ${err}`);
    }

    // ── Handoff routes (v2 tool-call protocol) ─────────────────────────
    // The launcher mounts these so any project session whose own server
    // hands a request through `/api/handoffs/emit` (e.g. via cross-port
    // proxy) still resolves correctly. The per-session server below also
    // mounts them; both share the same in-memory proposal map per process,
    // so a launcher-issued emit and a per-session confirm can't race.
    mountHandoffRoutes(app, {
      wsBridge,
      killSession: killActiveSession,
      launchSession: async (params) => {
        const result = await launchPneumaChild({
          specifier: params.mode,
          workspace: params.project,
          project: params.project,
          sessionId: params.sessionId,
        });
        return result.url;
      },
      // Launcher: look up the source session in the global registry to
      // recover its project root + mode + display name. Per-session servers
      // (below) shortcut this with their own options.pneumaProjectRoot.
      resolveSource: async (sourceSessionId) => {
        try {
          const { readSessionsFile } = await import("../bin/sessions-registry.js");
          const sessionsPath = join(homedir(), ".pneuma", "sessions.json");
          const data = await readSessionsFile(sessionsPath);
          const entry = data.sessions.find(
            (s) => s.kind === "project" && s.sessionId === sourceSessionId,
          );
          if (!entry || entry.kind !== "project") return null;
          return {
            projectRoot: entry.projectRoot,
            mode: entry.mode,
            displayName: entry.sessionName || entry.displayName,
          };
        } catch (err) {
          console.warn(`[handoff-routes] resolveSource (launcher) failed: ${err}`);
          return null;
        }
      },
    });

    // Serve frontend assets in launcher mode too
    if (options.distDir) {
      const distDir = options.distDir;
      // Serve static assets (JS/CSS bundles + public files like logo.png, favicon)
      app.get("*", async (c, next) => {
        const p = c.req.path;
        if (p.startsWith("/api/")) return next();
        const filePath = join(distDir, p);
        const file = Bun.file(filePath);
        if (await file.exists() && !p.endsWith("/")) return new Response(file);
        return next();
      });
      // SPA fallback
      app.get("*", async (c, next) => {
        if (c.req.path.startsWith("/api/")) return next();
        const html = await Bun.file(join(distDir, "index.html")).text();
        return new Response(html, { headers: { "Content-Type": "text/html" } });
      });
    }

    // Start server (no WebSocket needed for launcher)
    const MAX_PORT_ATTEMPTS = 10;
    let serverPort = port;
    let server!: ReturnType<typeof Bun.serve>;

    for (let attempt = 0; attempt < MAX_PORT_ATTEMPTS; attempt++) {
      try {
        server = Bun.serve({
          port: serverPort,
          hostname: "0.0.0.0",
          fetch: app.fetch,
        });
        break;
      } catch (err: any) {
        if (err?.code === "EADDRINUSE") {
          console.log(`[server] Port ${serverPort} is in use, trying ${serverPort + 1}...`);
          serverPort++;
        } else {
          throw err;
        }
      }
    }

    console.log(`[server] Launcher server running on http://localhost:${serverPort}`);
    return { server, wsBridge, terminalManager, port: serverPort, modeMakerCleanup: undefined, childProcesses, onReplayContinue: undefined, sessionInfo: undefined };
  }

  // ── Proxy config (hot-reloadable) ────────────────────────────────────
  const proxyConfigRef: ProxyConfigRef = { current: new Map() };

  // Load workspace proxy.json if it exists
  const proxyJsonPath = join(workspace, "proxy.json");
  let workspaceProxy: Record<string, ProxyRoute> | undefined;
  if (existsSync(proxyJsonPath)) {
    try {
      workspaceProxy = JSON.parse(readFileSync(proxyJsonPath, "utf-8"));
    } catch (err) {
      console.error(`[proxy] Failed to parse proxy.json: ${err}`);
    }
  }
  proxyConfigRef.current = mergeProxyConfig(options.manifestProxy, workspaceProxy);
  if (proxyConfigRef.current.size > 0) {
    console.log(`[proxy] Loaded ${proxyConfigRef.current.size} proxy route(s): ${[...proxyConfigRef.current.keys()].join(", ")}`);
  }

  // Watch proxy.json for hot reload
  startProxyWatcher(workspace, (config) => {
    proxyConfigRef.current = mergeProxyConfig(
      options.manifestProxy,
      config as Record<string, ProxyRoute> | undefined,
    );
    console.log(`[proxy] Config reloaded: ${proxyConfigRef.current.size} route(s)`);
  });

  // The v1 chokidar handoff watcher was deleted in the 2026-04-28 tool-call
  // rewrite. Handoffs now flow through `/api/handoffs/emit` and a server-side
  // proposal map; see `server/handoff-routes.ts`.

  // ── Plugin System ─────────────────────────────────────────────────────────
  const pneumaHome = join(homedir(), ".pneuma");
  const settingsManager = new SettingsManager(pneumaHome);
  settingsManager.migrateIfNeeded();
  const hookBus = new HookBus();

  const pluginRegistry = new PluginRegistry({
    builtinDir: join(import.meta.dir, "..", "plugins"),
    externalDir: join(pneumaHome, "plugins"),
    settingsManager,
    hookBus,
  });

  const discoveredPlugins = await pluginRegistry.discover();
  const enabledPlugins = pluginRegistry.filterEnabled(discoveredPlugins);
  const activePlugins = pluginRegistry.resolveForSession(enabledPlugins, options.modeName ?? "");

  // Per-session state dir resolution: explicit options.stateDir wins (project
  // sessions); falls back to <workspace>/.pneuma for legacy quick sessions.
  const stateDirForSession = options.stateDir ?? join(workspace, ".pneuma");
  const sessionInfo = {
    sessionId: (() => {
      try {
        const sp = join(stateDirForSession, "session.json");
        if (existsSync(sp)) return JSON.parse(readFileSync(sp, "utf-8")).sessionId ?? "";
      } catch {}
      return "";
    })(),
    mode: options.modeName ?? "",
    workspace,
    backendType: options.backendType ?? "",
  };

  await pluginRegistry.activateAll(activePlugins as any, sessionInfo);

  // Enrich preferences with plugin data (after activation, before session:start)
  {
    const { buildAndInjectPreferences } = await import("./skill-installer.js");
    const installName = `pneuma-${options.modeName ?? ""}`;
    // Project sessions: the CLAUDE.md lives next to the session-scoped skills,
    // not at the workspace root. Mirror the install path resolution below
    // so plugin enrichment lands in the file the agent actually reads.
    const instructionsRoot = options.sessionDir ?? workspace;
    await buildAndInjectPreferences(instructionsRoot, installName, options.backendType ?? "claude-code", hookBus, sessionInfo);
  }

  // Mount plugin routes
  pluginRegistry.mountRoutes(app, (pluginName) => ({
    workspace,
    session: sessionInfo,
    settings: settingsManager.getPluginConfig(pluginName),
    getDeployBinding: () => getDeployBinding(workspace, options.stateDir) as any,
    saveDeployBinding: (b) => saveDeployBinding(workspace, b as any, options.stateDir),
  }));

  // Install plugin skills + inject memory source info
  {
    const { injectMemorySourceInfo, resolvePluginSkillsBase } = await import("./skill-installer.js");
    const { cpSync, mkdirSync, existsSync: fsExists } = await import("node:fs");

    const bt = options.backendType;
    // Project sessions: the agent's CWD is `<projectRoot>/.pneuma/sessions/<id>/`,
    // so plugin skills must land under that session dir alongside the mode
    // skill. Quick sessions still resolve to `<workspace>/.claude/skills/`.
    // Falling back to the workspace root for project sessions (the previous
    // behavior) silently parked plugin skills where the session's agent
    // never reads them.
    const pluginSkillsRoot = options.sessionDir ?? workspace;
    const skillsBase = resolvePluginSkillsBase(workspace, options.sessionDir, bt);

    for (const plugin of pluginRegistry.getLoadedList()) {
      // Injection point 1: install plugin skill
      if (plugin.manifest.skill) {
        const skillSource = join(plugin.basePath, plugin.manifest.skill);
        if (fsExists(skillSource)) {
          const skillTarget = join(skillsBase, plugin.manifest.name);
          mkdirSync(skillTarget, { recursive: true });
          cpSync(skillSource, skillTarget, { recursive: true, force: true });

          // Apply user-configured template params to installed skill files
          // Merge: user config > manifest defaultValue > empty string
          const pluginConfig = settingsManager.getPluginConfig(plugin.manifest.name);
          const skillMdPath = join(skillTarget, "SKILL.md");
          if (fsExists(skillMdPath)) {
            const { readFileSync, writeFileSync } = await import("node:fs");
            let content = readFileSync(skillMdPath, "utf-8");

            // Build merged params: defaultValues from manifest, overridden by user config
            const merged: Record<string, string> = {};
            if (plugin.manifest.settings) {
              for (const [key, schema] of Object.entries(plugin.manifest.settings)) {
                if (schema.defaultValue !== undefined) {
                  merged[key] = String(schema.defaultValue);
                }
              }
            }
            for (const [key, value] of Object.entries(pluginConfig)) {
              if (typeof value === "string" && value.trim()) {
                merged[key] = value;
              }
            }

            for (const [key, value] of Object.entries(merged)) {
              // Detect indentation context: if placeholder is inside YAML frontmatter,
              // indent continuation lines to preserve valid YAML
              const placeholder = `{{${key}}}`;
              const idx = content.indexOf(placeholder);
              if (idx !== -1) {
                const lineStart = content.lastIndexOf("\n", idx) + 1;
                const indent = content.substring(lineStart, idx).match(/^(\s*)/)?.[1] ?? "";
                const indentedValue = value.replace(/\n/g, `\n${indent}`);
                content = content.replaceAll(placeholder, indentedValue);
              }
            }
            // Clean up any remaining unfilled placeholders
            content = content.replaceAll(/\{\{[a-zA-Z]+\}\}/g, "");
            writeFileSync(skillMdPath, content, "utf-8");
          }

          // Mark as plugin-installed for safe cleanup
          writeFileSync(join(skillTarget, ".plugin-installed"), plugin.manifest.name, "utf-8");

          console.log(`[plugin] Installed skill: ${plugin.manifest.name}`);
        }
      }
    }

    // Clean up skills from disabled plugins (only plugin-installed ones)
    if (existsSync(skillsBase)) {
      const activePluginNames = new Set(pluginRegistry.getLoadedList().map(p => p.manifest.name));
      for (const entry of readdirSync(skillsBase, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const markerPath = join(skillsBase, entry.name, ".plugin-installed");
        if (existsSync(markerPath)) {
          const installedBy = readFileSync(markerPath, "utf-8").trim();
          if (!activePluginNames.has(installedBy)) {
            const { rmSync } = await import("node:fs");
            rmSync(join(skillsBase, entry.name), { recursive: true, force: true });
            console.log(`[plugin] Removed disabled plugin skill: ${entry.name}`);
          }
        }
      }
    }

    // Injection point 2: register memory sources in preference skill
    const memorySources = pluginRegistry.getLoadedList()
      .filter((p) => p.manifest.memorySource && p.routes)
      .map((p) => ({
        name: p.manifest.name,
        displayName: p.manifest.displayName,
        routePrefix: p.manifest.routePrefix ?? `/api/plugins/${p.manifest.name}`,
      }));
    // Project sessions: rewrite the per-session pneuma-preferences SKILL.md
    // (the one the agent actually loads), not the workspace-level one.
    injectMemorySourceInfo(pluginSkillsRoot, memorySources, bt);
  }

  // Plugin list API
  app.get("/api/plugins", (c) => {
    const plugins = pluginRegistry.getLoadedList().map((p) => ({
      name: p.manifest.name,
      displayName: p.manifest.displayName,
      description: p.manifest.description,
      version: p.manifest.version,
      builtin: p.manifest.builtin ?? false,
      scope: p.manifest.scope,
      hasRoutes: !!p.routes,
      hooks: Object.keys(p.hooks),
      slots: Object.keys(p.slots),
      settings: p.manifest.settings ? Object.keys(p.manifest.settings) : [],
      routePrefix: p.manifest.routePrefix ?? `/api/plugins/${p.manifest.name}`,
    }));
    return c.json({ plugins });
  });

  app.get("/api/slots/:slotName", (c) => {
    const slotName = c.req.param("slotName") as any;
    const entries = pluginRegistry.getSlotEntries(slotName);
    // Resolve string declarations (component paths) to importable URLs
    const resolved = entries.map((entry) => {
      if (typeof entry.declaration === "string") {
        // Resolve relative path against plugin's basePath
        const plugin = pluginRegistry.getLoaded().get(entry.pluginName);
        if (plugin) {
          const absPath = join(plugin.basePath, entry.declaration);
          // In dev: use /@fs/ prefix for Vite to serve
          return { ...entry, declaration: { type: "component" as const, importUrl: `/@fs${absPath}` } };
        }
      }
      return entry;
    });
    return c.json({ entries: resolved });
  });

  // ── Deploy orchestrator (runs hooks, forwards to provider) ────────────────
  app.post("/api/deploy", async (c) => {
    try {
      const body = await c.req.json<{
        provider: string;
        files: Array<{ path: string; content: string }>;
        projectName?: string;
        formValues?: Record<string, Record<string, unknown>>;
        contentSet?: string;
        [key: string]: unknown;
      }>();

      // Run deploy:before hooks (waterfall — plugins can modify payload)
      const enrichedPayload = await hookBus.emit("deploy:before", body, sessionInfo);

      // Forward to the provider's deploy endpoint
      const plugin = pluginRegistry.getLoaded().get(enrichedPayload.provider);
      if (!plugin) {
        return c.json({ error: `Unknown deploy provider: ${enrichedPayload.provider}` }, 400);
      }

      const prefix = plugin.manifest.routePrefix ?? `/api/plugins/${enrichedPayload.provider}`;

      // Build internal request to the plugin's deploy route
      const internalUrl = new URL(`http://localhost${prefix}/deploy`);
      const deployResp = await app.fetch(
        new Request(internalUrl.toString(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(enrichedPayload),
        }),
      );
      const result = await deployResp.json();

      // Run deploy:after hooks
      await hookBus.emit("deploy:after", { result, provider: enrichedPayload.provider, payload: enrichedPayload }, sessionInfo);

      return c.json(result);
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  let replayPackage: Awaited<ReturnType<typeof importHistory>> | null = null;
  let serverReplayMode = options.replayMode ?? !!options.replayPackagePath;
  let replayContinueCallback: (() => Promise<void>) | null = null;
  let currentEditing: boolean = options.editing ?? true;
  let editingLaunchCallback: (() => Promise<void>) | null = null;
  let editingKillCallback: (() => Promise<void>) | null = null;

  // Pre-load replay package if path was provided at startup
  if (options.replayPackagePath) {
    importHistory(options.replayPackagePath).then(pkg => {
      replayPackage = pkg;
      console.log(`[server] Pre-loaded replay package from ${options.replayPackagePath}`);
    }).catch(err => {
      console.error(`[server] Failed to pre-load replay package: ${err.message}`);
    });
  }

  // ── Slide Preset API ─────────────────────────────────────────────────
  const presetsDir = resolve(dirname(import.meta.path), "../modes/slide/skill/presets");

  app.get("/api/slide-presets", async (c) => {
    try {
      const data = await Bun.file(join(presetsDir, "index.json")).text();
      return c.json({ presets: JSON.parse(data) });
    } catch {
      return c.json({ presets: [] });
    }
  });

  app.get("/api/slide-presets/preview-slides", async (c) => {
    try {
      const data = await Bun.file(join(presetsDir, "preview-slides.json")).text();
      return c.json({ slides: JSON.parse(data) });
    } catch {
      return c.json({ slides: [] });
    }
  });

  app.get("/api/slide-presets/:id/theme", async (c) => {
    const id = c.req.param("id");
    if (!/^[a-z0-9-]+$/.test(id)) return c.json({ error: "Invalid preset ID" }, 400);
    try {
      const css = await Bun.file(join(presetsDir, `themes/${id}.css`)).text();
      return c.json({ css });
    } catch {
      return c.json({ error: "Preset not found" }, 404);
    }
  });

  // ── API Routes ─────────────────────────────────────────────────────────

  // Return the current active session ID so browsers can auto-connect.
  // Project sessions also include the project paths so the frontend can
  // populate `projectContext` (used by HandoffCard, etc.).
  app.get("/api/session", async (c) => {
    // Project-session paths come from `pneumaProjectRoot` (the user's project
    // root). The legacy `projectRoot` field is overloaded to mean the
    // pneuma-skills repo root (used by mode-maker / registry routes), so it
    // can't be used to detect a project session here.
    let projectInfo: {
      projectRoot: string;
      homeRoot: string;
      sessionDir: string;
      projectName?: string;
      projectDescription?: string;
    } | null = null;
    if (options.pneumaProjectRoot) {
      // Enrich with manifest fields so the frontend can label the chip
      // without an extra fetch. Manifest read is cheap (small JSON file)
      // and tolerant of failure — fields stay undefined on error.
      const manifest = await loadProjectManifest(options.pneumaProjectRoot).catch(() => null);
      projectInfo = {
        projectRoot: options.pneumaProjectRoot,
        homeRoot: options.pneumaProjectRoot,
        sessionDir: stateDirForSession,
        ...(manifest?.displayName ? { projectName: manifest.displayName } : {}),
        ...(manifest?.description ? { projectDescription: manifest.description } : {}),
      };
    }
    return c.json({
      sessionId: wsBridge.getActiveSessionId(),
      project: projectInfo,
    });
  });

  // Save session thumbnail
  app.post("/api/session/thumbnail", async (c) => {
    try {
      const body = await c.req.json();
      const { data } = body; // base64 PNG data
      if (!data) return c.json({ error: "Missing data" }, 400);
      const thumbDir = stateDirForSession;
      if (!existsSync(thumbDir)) mkdirSync(thumbDir, { recursive: true });
      const thumbPath = join(thumbDir, "thumbnail.png");
      const buffer = Buffer.from(data, "base64");
      writeFileSync(thumbPath, buffer);
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: "Failed to save thumbnail" }, 500);
    }
  });

  // ── Editing state switching (app layout only) ──────────────────────────
  app.post("/api/session/editing", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const newEditing: boolean = body.editing;
    if (typeof newEditing !== "boolean") {
      return c.json({ error: "editing must be a boolean" }, 400);
    }

    const oldEditing = currentEditing;
    currentEditing = newEditing;

    // Persist to session.json
    try {
      const sessionPath = join(stateDirForSession, "session.json");
      if (existsSync(sessionPath)) {
        const session = JSON.parse(readFileSync(sessionPath, "utf-8"));
        session.editing = newEditing;
        writeFileSync(sessionPath, JSON.stringify(session, null, 2));
      }
    } catch (err) {
      console.error("[server] Failed to persist editing:", err);
    }

    // Agent lifecycle: launch when editing, kill when not editing
    let agentStatus: "launched" | "killed" | "unchanged" = "unchanged";

    if (newEditing === true && oldEditing === false) {
      if (editingLaunchCallback) {
        try {
          await editingLaunchCallback();
          agentStatus = "launched";
        } catch (err) {
          console.error("[server] Failed to launch agent:", err);
          return c.json({ error: "Failed to launch agent" }, 500);
        }
      }
    } else if (newEditing === false && oldEditing === true) {
      const activeId = wsBridge.getActiveSessionId();
      if (activeId) wsBridge.broadcastToSession(activeId, { type: "cli_disconnected" });
      agentStatus = "killed";
      if (editingKillCallback) {
        try {
          await editingKillCallback();
        } catch (err) {
          console.error("[server] Failed to kill agent:", err);
        }
      }
    }

    console.log(`[server] Editing: ${oldEditing} → ${newEditing} (agent: ${agentStatus})`);
    return c.json({ ok: true, agentStatus });
  });

  // ── App settings (window size, resizable, etc.) ────────────────────────
  const appSettingsPath = join(stateDirForSession, "app-settings.json");

  const loadAppSettings = () => {
    try {
      return JSON.parse(readFileSync(appSettingsPath, "utf-8"));
    } catch {
      return {};
    }
  };

  app.get("/api/app-settings", (c) => {
    return c.json(loadAppSettings());
  });

  app.post("/api/app-settings", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const current = loadAppSettings();
    const merged = { ...current, ...body };
    mkdirSync(stateDirForSession, { recursive: true });
    writeFileSync(appSettingsPath, JSON.stringify(merged, null, 2));
    return c.json({ ok: true, settings: merged });
  });

  // ── Native bridge (Electron desktop APIs) ───────────────────────────
  mountNativeRoutes(app);

  // ── Mode registry (shared with launcher) ────────────────────────────
  // The per-session ModeSwitcherDropdown fetches `/api/registry` to populate
  // the mode list when switching modes inside a project. Mounted here on the
  // per-session server so the dropdown works regardless of which port it
  // talks to.
  mountRegistryRoute(app);

  // ── Project routes API ──────────────────────────────────────────────
  mountProjectsRoutes(app, { homeDir: homedir() });

  // Prime the per-project cache. Per-session servers care most about the
  // current project (high probability the user opens its panel first) but
  // we prime everything for parity with the launcher — the panel can list
  // all projects via `/api/projects`. Fire-and-forget to keep startup fast.
  try {
    const registryData = readSessionsFileSync(
      join(homedir(), ".pneuma", "sessions.json"),
    );
    for (const p of registryData.projects) {
      primeProjectCache(p.root).catch((err) => {
        console.warn(`[projects-cache] prime failed for ${p.root}: ${err}`);
      });
    }
  } catch (err) {
    console.warn(`[projects-cache] prime-on-start failed: ${err}`);
  }
  if (options.pneumaProjectRoot) {
    primeProjectCache(options.pneumaProjectRoot).catch((err) => {
      console.warn(
        `[projects-cache] prime current project failed: ${err}`,
      );
    });
  }

  // ── Handoff routes (v2 tool-call protocol) ──────────────────────────
  // Mounted on the per-session server so the source agent's
  // `pneuma handoff` invocation reaches the same server that's driving
  // its session — the WS broadcast then lands in the source's browser.
  // `killActiveSession` only matches processes we spawned; a session asked
  // to kill itself simply no-ops (the user's tab keeps the source running
  // until they close it).
  const handoffRoutesContext = mountHandoffRoutes(app, {
    wsBridge,
    killSession: killActiveSession,
    launchSession: async (params) => {
      const result = await launchPneumaChild({
        specifier: params.mode,
        workspace: params.project,
        project: params.project,
        sessionId: params.sessionId,
      });
      return result.url;
    },
    // Per-session shortcut: the active session id resolved by this server
    // *is* a project session (when pneumaProjectRoot is set); use the
    // server's already-known project root + mode + display name. The
    // registry is consulted as a fallback for any unknown id (e.g.
    // siblings the source might somehow reference).
    resolveSource: async (sourceSessionId) => {
      const activeId = wsBridge.getActiveSessionId();
      if (
        sourceSessionId === activeId &&
        options.pneumaProjectRoot &&
        options.modeName
      ) {
        const manifest = await loadProjectManifest(options.pneumaProjectRoot).catch(() => null);
        return {
          projectRoot: options.pneumaProjectRoot,
          mode: options.modeName,
          displayName: manifest?.displayName ?? undefined,
        };
      }
      try {
        const { readSessionsFile } = await import("../bin/sessions-registry.js");
        const sessionsPath = join(homedir(), ".pneuma", "sessions.json");
        const data = await readSessionsFile(sessionsPath);
        const entry = data.sessions.find(
          (s) => s.kind === "project" && s.sessionId === sourceSessionId,
        );
        if (!entry || entry.kind !== "project") return null;
        return {
          projectRoot: entry.projectRoot,
          mode: entry.mode,
          displayName: entry.sessionName || entry.displayName,
        };
      } catch (err) {
        console.warn(`[handoff-routes] resolveSource (per-session) failed: ${err}`);
        return null;
      }
    },
  });

  // /api/launch/prepare in the per-session server — lets ProjectPanel's
  // launch sheet pre-fetch a mode's init params (with auto-fill from stored
  // API keys) before the user confirms. Mirrors the launcher block above;
  // both branches share the same resolve → loadModeManifest → autoFill path.
  app.post("/api/launch/prepare", async (c) => {
    const { specifier } = await c.req.json<{ specifier: string }>();
    try {
      const { resolveMode } = await import("../core/mode-resolver.js");
      const projectRoot = options.projectRoot || resolve(dirname(import.meta.path), "..");
      const resolved = await resolveMode(specifier, projectRoot);

      if (resolved.type !== "builtin") {
        const { registerExternalMode } = await import("../core/mode-loader.js");
        registerExternalMode(resolved.name, resolved.path);
      }

      const { loadModeManifest } = await import("../core/mode-loader.js");
      const manifest = await loadModeManifest(resolved.name);

      // Auto-fill defaults from stored API keys — same matching as the
      // launcher route (exact name, UPPER_SNAKE ↔ camelCase).
      const storedKeys = getApiKeys();
      const camelFromSnake = (s: string) =>
        s.toLowerCase().replace(/_([a-z])/g, (_: string, c: string) => c.toUpperCase());
      const snakeFromCamel = (s: string) =>
        s.replace(/[A-Z]/g, (c: string) => `_${c}`).toUpperCase();

      const params = (manifest.init?.params || []).map((p: any) => {
        let matchedValue: string | null = null;
        if (storedKeys[p.name]) {
          matchedValue = storedKeys[p.name];
        } else {
          for (const [storedName, storedValue] of Object.entries(storedKeys)) {
            if (camelFromSnake(storedName) === p.name || snakeFromCamel(p.name) === storedName) {
              matchedValue = storedValue;
              break;
            }
          }
        }
        if (matchedValue) {
          const masked = matchedValue.slice(0, 4) + "****" + matchedValue.slice(-4);
          return { ...p, defaultValue: matchedValue, autoFilled: true, maskedPreview: masked };
        }
        return p;
      });

      return c.json({
        name: resolved.name,
        displayName: manifest.displayName,
        initParams: params,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 400);
    }
  });

  // /api/launch in the per-session server — lets ProjectPanel spawn sibling
  // sessions in the same project (e.g. clicking a session row, "+ New mode
  // session", or starting in another mode). Mirrors the launcher's mount;
  // children spawned here track in this server's `childProcesses` map.
  app.post("/api/launch", async (c) => {
    const body = await c.req.json<{
      specifier: string;
      workspace: string;
      initParams?: Record<string, string | number>;
      skipSkill?: boolean;
      backendType?: AgentBackendType;
      replayPackage?: string;
      replaySource?: string;
      sessionName?: string;
      viewing?: boolean;
      project?: string;
      sessionId?: string;
      from_session_id?: string;
      from_mode?: string;
      from_display_name?: string;
    }>();
    try {
      const result = await launchPneumaChild({
        specifier: body.specifier,
        workspace: body.workspace,
        initParams: body.initParams,
        skipSkill: body.skipSkill,
        backendType: body.backendType,
        replayPackage: body.replayPackage,
        replaySource: body.replaySource,
        sessionName: body.sessionName,
        viewing: body.viewing,
        project: body.project,
        sessionId: body.sessionId,
        fromSessionId: body.from_session_id,
        fromMode: body.from_mode,
        fromDisplayName: body.from_display_name,
      });
      return c.json({ url: result.url, workspace: result.workspace, mode: body.specifier });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  app.get("/api/history/checkpoints", async (c) => {
    const checkpoints = await listCheckpoints(workspace, options.stateDir);
    return c.json({ checkpoints });
  });

  app.post("/api/history/export", async (c) => {
    try {
      const body = await c.req.json<{ title?: string; description?: string }>();
      const result = await exportHistory(workspace, {
        title: body.title,
        description: body.description,
        stateDir: options.stateDir,
      });
      return c.json(result);
    } catch (err: any) {
      return c.json({ error: err.message ?? "Export failed" }, 500);
    }
  });

  // --- R2 Config ---
  app.get("/api/r2/status", (c) => {
    const config = getR2Config();
    return c.json({
      configured: !!config,
      publicUrl: config?.publicUrl ?? null,
    });
  });

  // --- Unified Share ---
  app.post("/api/share/result", async (c) => {
    try {
      const body = await c.req.json<{ title?: string }>();
      const result = await shareResult(workspace, body.title, options.stateDir);
      return c.json(result);
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  app.post("/api/share/process", async (c) => {
    try {
      const body = await c.req.json<{ title?: string }>();
      const result = await shareProcess(workspace, body.title, options.stateDir);
      return c.json(result);
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  // Vercel/CF deploy routes removed — now served by plugin routes at /api/plugins/vercel-deploy/* and /api/plugins/cf-pages-deploy/*

  app.post("/api/replay/load", async (c) => {
    try {
      const body = await c.req.json<{ path: string }>();
      replayPackage = await importHistory(body.path);
      return c.json({
        manifest: replayPackage.manifest,
        messageCount: replayPackage.messages.length,
      });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  app.get("/api/replay/messages", (c) => {
    if (!replayPackage) return c.json({ error: "No replay loaded" }, 400);
    return c.json({ messages: replayPackage.messages });
  });

  app.post("/api/replay/checkout/:hash", async (c) => {
    if (!replayPackage) return c.json({ error: "No replay loaded" }, 400);
    const hash = c.req.param("hash");
    // Extract to replay-checkout (clean slate each time) so /content/* serves correct per-checkpoint state
    const stateDirForReplay = options.stateDir ?? join(workspace, ".pneuma");
    const outDir = join(stateDirForReplay, "replay-checkout");
    try {
      const { rmSync: rm } = await import("node:fs");
      rm(outDir, { recursive: true, force: true });
    } catch {}
    try {
      await replayPackage.extractCheckpointFiles(hash, outDir);
      const files: { path: string; content: string }[] = [];
      function walk(dir: string, prefix: string) {
        for (const entry of readdirSync(dir)) {
          const full = join(dir, entry);
          const rel = prefix ? `${prefix}/${entry}` : entry;
          const stat = statSync(full);
          if (stat.isDirectory()) walk(full, rel);
          else if (stat.size < 500_000) {
            try { files.push({ path: rel, content: readFileSync(full, "utf-8") }); } catch {}
          }
        }
      }
      walk(outDir, "");
      return c.json({ files });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  // Replay status — frontend queries to know current replay state
  app.get("/api/replay/status", (c) => {
    return c.json({ replayMode: serverReplayMode });
  });

  // Continue Work — transition from replay to normal session
  app.post("/api/replay/continue", async (c) => {
    if (!serverReplayMode) {
      return c.json({ error: "Not in replay mode" }, 400);
    }

    try {
      const { prepareWorkspaceForContinue } = await import("./replay-continue.js");

      // 1. Apply final checkpoint files directly to workspace
      if (replayPackage) {
        const checkpoints = replayPackage.manifest.checkpoints;
        const lastCheckpoint = checkpoints[checkpoints.length - 1];
        if (lastCheckpoint) {
          await replayPackage.extractCheckpointFiles(lastCheckpoint.hash, workspace);
        }
      }

      // 2. Prepare workspace (clear replay state, re-init shadow-git, write context)
      const summary = replayPackage?.manifest.summary ?? {
        overview: "", keyDecisions: [], workspaceFiles: [], recentConversation: "",
      };
      const originalMode = replayPackage?.manifest.metadata.mode ?? options.modeName ?? "unknown";
      await prepareWorkspaceForContinue(workspace, { originalMode, summary, stateDir: options.stateDir });

      // 3. Clear replay package reference
      replayPackage = null;
      serverReplayMode = false;

      // 4. Trigger agent launch callback (registered by CLI)
      console.log(`[server] Continue Work: replayContinueCallback=${!!replayContinueCallback}`);
      if (replayContinueCallback) {
        await replayContinueCallback();
        console.log("[server] Continue Work: callback completed");
      } else {
        console.warn("[server] Continue Work: NO callback registered!");
      }

      return c.json({ ok: true, workspace, mode: options.modeName });
    } catch (err: any) {
      console.error("[server] Continue Work failed:", err);
      return c.json({ error: err.message || String(err) }, 500);
    }
  });

  // Return mode init params for the frontend
  app.get("/api/config", (c) => {
    return c.json({
      initParams: options.initParams || {},
      layout: options.layout || "editor",
      ...(options.window ? { window: options.window } : {}),
      replayMode: serverReplayMode,
      editing: currentEditing,
      editingSupported: options.editingSupported ?? false,
      appSettings: (() => { try { return JSON.parse(readFileSync(appSettingsPath, "utf-8")); } catch { return {}; } })(),
    });
  });

  // Return external mode info for the frontend (needed for /@fs/ imports)
  app.get("/api/mode-info", (c) => {
    if (options.externalMode) {
      return c.json({
        external: true,
        name: options.externalMode.name,
        path: options.externalMode.path,
        type: options.externalMode.type,
      });
    }
    return c.json({ external: false });
  });

  // ── Viewer State Persistence ─────────────────────────────────────────
  const viewerStatePath = workspace ? join(stateDirForSession, "viewer-state.json") : null;

  app.get("/api/viewer-state", (c) => {
    if (!viewerStatePath || !existsSync(viewerStatePath)) return c.json({});
    try { return c.json(JSON.parse(readFileSync(viewerStatePath, "utf-8"))); } catch { return c.json({}); }
  });

  app.post("/api/viewer-state", async (c) => {
    if (!viewerStatePath) return c.json({ ok: false }, 400);
    try {
      const body = await c.req.json<{ contentSet?: string | null; file?: string | null }>();
      const dir = dirname(viewerStatePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(viewerStatePath, JSON.stringify(body, null, 2));
      return c.json({ ok: true });
    } catch { return c.json({ ok: false }, 500); }
  });

  // ── Viewer Action API ───────────────────────────────────────────────
  app.post("/api/viewer/action", async (c) => {
    try {
      const body = await c.req.json<{ actionId: string; params?: Record<string, unknown> }>();
      if (!body.actionId) {
        return c.json({ success: false, message: "actionId is required" }, 400);
      }
      const result = await wsBridge.dispatchViewerAction(body.actionId, body.params);
      return c.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return c.json({ success: false, message }, 500);
    }
  });

  // ── System Bridge API (OS-level operations for Viewer) ──────────────
  app.post("/api/system/open", async (c) => {
    const body = await c.req.json<{ path: string }>();
    if (!body.path) return c.json({ success: false, message: "path is required" }, 400);
    return c.json(await openPath(workspace, body.path));
  });

  app.post("/api/system/open-url", async (c) => {
    const body = await c.req.json<{ url: string }>();
    if (!body.url) return c.json({ success: false, message: "url is required" }, 400);
    return c.json(await openUrl(body.url));
  });

  app.post("/api/system/reveal", async (c) => {
    const body = await c.req.json<{ path: string }>();
    if (!body.path) return c.json({ success: false, message: "path is required" }, 400);
    return c.json(await revealPath(workspace, body.path));
  });

  // ── Workspace Scaffold API ───────────────────────────────────────────
  app.post("/api/workspace/scaffold", async (c) => {
    try {
      const body = await c.req.json<{ clear?: string[]; files: { path: string; content: string }[]; contentSet?: string }>();
      if (!Array.isArray(body.files)) {
        return c.json({ success: false, message: "files array is required" }, 400);
      }

      // Content set scoping: when provided, clear globs scan within the content set
      // directory and file paths are prefixed with it.
      const contentSet = body.contentSet?.replace(/^\/+|\/+$/g, ""); // sanitize
      const scopedRoot = contentSet ? join(workspace, contentSet) : workspace;
      if (contentSet && !pathStartsWith(scopedRoot, workspace)) {
        return c.json({ success: false, message: `Invalid contentSet: ${contentSet}` }, 403);
      }

      // Prefix file paths with content set if scoped
      const resolvedFiles = body.files.map((f) => ({
        path: contentSet ? `${contentSet}/${f.path}` : f.path,
        content: f.content,
      }));

      // Validate all paths before performing any mutations
      for (const f of resolvedFiles) {
        if (!f.path || f.path.includes("..") || f.path.startsWith("/")) {
          return c.json({ success: false, message: `Invalid path: ${f.path}` }, 400);
        }
        const abs = join(workspace, f.path);
        if (!pathStartsWith(abs, workspace)) {
          return c.json({ success: false, message: `Path escapes workspace: ${f.path}` }, 403);
        }
      }

      // Protected paths — never delete system files
      const PROTECTED = [".claude/", ".pneuma/", "CLAUDE.md", ".gitignore", ".mcp.json"];
      const isProtected = (relPath: string) =>
        PROTECTED.some((p) => p.endsWith("/") ? relPath.startsWith(p) : relPath === p);

      // 1. Delete files matching clear globs (scoped to contentSet if provided)
      let filesDeleted = 0;
      if (Array.isArray(body.clear)) {
        for (const pattern of body.clear) {
          try {
            const matches = new Bun.Glob(pattern).scanSync({ cwd: scopedRoot, absolute: false });
            for (const matchPath of matches) {
              // matchPath is relative to scopedRoot; compute workspace-relative path
              const relPath = contentSet ? `${contentSet}/${matchPath}` : matchPath;
              if (isProtected(relPath)) continue;
              const absPath = join(workspace, relPath);
              if (pathStartsWith(absPath, workspace) && existsSync(absPath)) {
                unlinkSync(absPath);
                filesDeleted++;
              }
            }
          } catch {
            // skip invalid globs
          }
        }
      }

      // 2. Write files
      for (const f of resolvedFiles) {
        const absPath = join(workspace, f.path);
        mkdirSync(dirname(absPath), { recursive: true });
        writeFileSync(absPath, f.content, "utf-8");
      }

      return c.json({ success: true, filesWritten: resolvedFiles.length, filesDeleted });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return c.json({ success: false, message }, 500);
    }
  });

  // ── Export routes (slide, webcraft, file listing) ─────────────────
  registerExportRoutes(app, { workspace, initParams: options.initParams, watchPatterns: options.watchPatterns, hookBus, sessionInfo });

  // ── Asset filesystem listing (clipcraft-style modes) ───────────────
  registerAssetFsRoutes(app, { workspace });

  // ── Save file ────────────────────────────────────────────────────────
  app.post("/api/files", async (c) => {
    const body = await c.req.json<{ path: string; content: string }>();
    const relPath = body.path;
    if (!relPath || typeof body.content !== "string") {
      return c.json({ error: "Missing path or content" }, 400);
    }
    const absPath = join(workspace, relPath);
    if (!pathStartsWith(absPath, workspace)) {
      return c.json({ error: "Forbidden" }, 403);
    }
    // `?origin=external` tells the server "this write is a user-initiated
    // edit, not a Source<T> autosave echo." When set, we skip the
    // registerSelfWrite call so the resulting chokidar event is tagged
    // origin: "external" and every Source<T> in the viewer treats it as
    // a real external change (refreshing its value, triggering remount,
    // etc). The built-in EditorPanel uses this; Source<T>'s own
    // FileChannel.write() does NOT (its echo IS a true self-write).
    const origin = c.req.query("origin");
    const isExternalWrite = origin === "external";
    try {
      mkdirSync(dirname(absPath), { recursive: true });
      // Support data URL content — decode to binary
      const dataUrlMatch = body.content.match(/^data:[^;]+;base64,(.+)$/);
      if (dataUrlMatch) {
        writeFileSync(absPath, Buffer.from(dataUrlMatch[1], "base64"));
      } else {
        // Register this write as self-originated so the chokidar echo is
        // tagged origin: "self" when it arrives. Registration happens BEFORE
        // the disk write so there's no window where the echo could arrive
        // ahead of the registration. Binary writes (data URLs) take the
        // image-cache-bust path in the watcher and don't need origin tracking.
        if (!isExternalWrite) {
          registerSelfWrite(relPath, body.content);
        }
        writeFileSync(absPath, body.content, "utf-8");
      }
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: "Failed to write file" }, 500);
    }
  });

  // ── Delete file ────────────────────────────────────────────────────
  app.delete("/api/files", async (c) => {
    const relPath = c.req.query("path");
    if (!relPath || typeof relPath !== "string") {
      return c.json({ error: "Missing path query parameter" }, 400);
    }
    const absPath = join(workspace, relPath);
    if (!pathStartsWith(absPath, workspace)) {
      return c.json({ error: "Forbidden" }, 403);
    }
    try {
      // Register the self-delete BEFORE unlinking so the chokidar unlink
      // event is tagged origin: "self" when it arrives.
      registerSelfDelete(relPath);
      if (existsSync(absPath)) {
        unlinkSync(absPath);
      }
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: "Failed to delete file" }, 500);
    }
  });

  // ── Read single file ────────────────────────────────────────────────
  app.get("/api/files/read", (c) => {
    const relPath = c.req.query("path");
    if (!relPath) return c.json({ error: "Missing path" }, 400);
    const absPath = join(workspace, relPath);
    if (!pathStartsWith(absPath, workspace)) return c.json({ error: "Forbidden" }, 403);
    try {
      const content = readFileSync(absPath, "utf-8");
      return c.json({ path: relPath, content });
    } catch {
      return c.json({ error: "File not found" }, 404);
    }
  });

  // ── File tree ──────────────────────────────────────────────────────
  app.get("/api/files/tree", (c) => {
    interface TreeNode {
      name: string;
      path: string;
      type: "file" | "directory";
      children?: TreeNode[];
    }
    // Pneuma-managed state files in the session dir. They're visualized
    // by ProjectOverview (sessions roll-up, preferences, cover) so the
    // user doesn't need them in the file tree alongside actual content.
    // Dot-prefixed paths (.pneuma, .claude, .agents, .git, etc.) are
    // already filtered by the leading-dot rule below.
    const PNEUMA_STATE_FILES = new Set([
      "CLAUDE.md",
      "AGENTS.md",
      "session.json",
      "history.json",
      "config.json",
      "skill-version.json",
      "skill-dismissed.json",
      "checkpoints.jsonl",
      "thumbnail.png",
      "viewer-state.json",
      "deploy.json",
      "resumed-context.xml",
    ]);
    const PNEUMA_STATE_DIRS = new Set([
      "shadow.git",
      "replay-checkout",
      "evolution",
    ]);
    function buildTree(dir: string, relBase: string): TreeNode[] {
      const entries = readdirSync(dir, { withFileTypes: true })
        .filter((e) => {
          if (e.name.startsWith(".")) return false;
          if (e.name === "node_modules") return false;
          if (e.isDirectory() && PNEUMA_STATE_DIRS.has(e.name)) return false;
          if (!e.isDirectory() && PNEUMA_STATE_FILES.has(e.name)) return false;
          return true;
        })
        .sort((a, b) => {
          if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      return entries.map((e) => {
        const rel = relBase ? `${relBase}/${e.name}` : e.name;
        if (e.isDirectory()) {
          return { name: e.name, path: rel, type: "directory" as const, children: buildTree(join(dir, e.name), rel) };
        }
        return { name: e.name, path: rel, type: "file" as const };
      });
    }
    return c.json({ tree: buildTree(workspace, "") });
  });

  // ── Git: availability check ────────────────────────────────────────
  app.get("/api/git/available", (c) => {
    try {
      execSync("git rev-parse --is-inside-work-tree", { cwd: workspace, encoding: "utf-8", timeout: 3_000, stdio: ["pipe", "pipe", "pipe"] });
      return c.json({ available: true });
    } catch {
      return c.json({ available: false });
    }
  });

  // ── Manual refresh: queue content updates, flush on demand ──────────
  let pendingContentUpdate: { path: string; content: string }[] | null = null;

  const queueContentUpdate = (files: { path: string; content: string }[]) => {
    pendingContentUpdate = files;
  };

  app.post("/api/refresh", (c) => {
    if (pendingContentUpdate) {
      const sid = wsBridge.getActiveSessionId();
      if (sid) {
        wsBridge.broadcastToSession(sid, { type: "content_update", files: pendingContentUpdate });
      }
      pendingContentUpdate = null;
      return c.json({ flushed: true });
    }
    return c.json({ flushed: false });
  });

  // ── Git: branch info (for Context panel) ────────────────────────────
  app.get("/api/git/info", (c) => {
    try {
      const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: workspace, encoding: "utf-8", timeout: 3_000, stdio: ["pipe", "pipe", "pipe"] }).trim();
      let ahead = 0;
      let behind = 0;
      try {
        const counts = execSync("git rev-list --left-right --count HEAD...@{upstream}", { cwd: workspace, encoding: "utf-8", timeout: 5_000, stdio: ["pipe", "pipe", "pipe"] }).trim();
        const [a, b] = counts.split(/\s+/);
        ahead = parseInt(a, 10) || 0;
        behind = parseInt(b, 10) || 0;
      } catch { /* no upstream set */ }
      return c.json({ branch, ahead, behind });
    } catch {
      return c.json({ branch: null, ahead: 0, behind: 0 });
    }
  });

  // ── Git: changed files ─────────────────────────────────────────────
  app.get("/api/git/changed-files", (c) => {
    const base = c.req.query("base") || "last-commit";
    const files = new Map<string, string>(); // relPath → status (A/M/D)
    try {
      // Uncommitted changes vs HEAD
      const nameStatus = execSync("git -c core.quotePath=false diff HEAD --name-status", { cwd: workspace, encoding: "utf-8", timeout: 10_000, stdio: ["pipe", "pipe", "pipe"] }).trim();
      for (const line of nameStatus.split("\n").filter(Boolean)) {
        const [status, ...parts] = line.split("\t");
        const filePath = parts.join("\t");
        if (status && filePath) files.set(filePath, status.charAt(0));
      }
      // Untracked files
      const untracked = execSync("git -c core.quotePath=false ls-files --others --exclude-standard", { cwd: workspace, encoding: "utf-8", timeout: 10_000, stdio: ["pipe", "pipe", "pipe"] }).trim();
      for (const filePath of untracked.split("\n").filter(Boolean)) {
        if (!files.has(filePath)) files.set(filePath, "A");
      }
      // Branch diff (if requested)
      if (base === "default-branch") {
        try {
          const defaultBranch = execSync("git symbolic-ref refs/remotes/origin/HEAD --short", { cwd: workspace, encoding: "utf-8", timeout: 5_000, stdio: ["pipe", "pipe", "pipe"] }).trim();
          const branchStatus = execSync(`git -c core.quotePath=false diff ${defaultBranch}...HEAD --name-status`, { cwd: workspace, encoding: "utf-8", timeout: 10_000, stdio: ["pipe", "pipe", "pipe"] }).trim();
          for (const line of branchStatus.split("\n").filter(Boolean)) {
            const [status, ...parts] = line.split("\t");
            const filePath = parts.join("\t");
            if (status && filePath && !files.has(filePath)) files.set(filePath, status.charAt(0));
          }
        } catch { /* no default branch info available */ }
      }
    } catch {
      // Not a git repo or git not available
    }
    const result = Array.from(files.entries()).map(([path, status]) => ({ path, status }));
    return c.json({ files: result });
  });

  // ── Git: file diff ─────────────────────────────────────────────────
  app.get("/api/git/diff", (c) => {
    const filePath = c.req.query("path");
    if (!filePath) return c.json({ error: "Missing path" }, 400);
    const base = c.req.query("base") || "last-commit";
    try {
      let diff = "";
      const absPath = join(workspace, filePath);
      // Check if file is untracked
      const tracked = execSync(`git -c core.quotePath=false ls-files -- "${filePath}"`, { cwd: workspace, encoding: "utf-8", timeout: 5_000, stdio: ["pipe", "pipe", "pipe"] }).trim();
      if (!tracked) {
        // Untracked new file — diff against /dev/null (NUL on Windows)
        try {
          const devNull = isWin ? "NUL" : "/dev/null";
          diff = execSync(`git -c core.quotePath=false diff --no-index -- ${devNull} "${absPath}"`, { cwd: workspace, encoding: "utf-8", timeout: 10_000, stdio: ["pipe", "pipe", "pipe"] }).trim();
        } catch (e: any) {
          // git diff --no-index exits with 1 when there are differences
          diff = e.stdout?.toString() || "";
        }
      } else if (base === "default-branch") {
        try {
          const defaultBranch = execSync("git symbolic-ref refs/remotes/origin/HEAD --short", { cwd: workspace, encoding: "utf-8", timeout: 5_000, stdio: ["pipe", "pipe", "pipe"] }).trim();
          diff = execSync(`git -c core.quotePath=false diff ${defaultBranch}...HEAD -- "${filePath}"`, { cwd: workspace, encoding: "utf-8", timeout: 10_000, stdio: ["pipe", "pipe", "pipe"] }).trim();
        } catch { /* fallback to HEAD */ }
        if (!diff) {
          try {
            diff = execSync(`git -c core.quotePath=false diff HEAD -- "${filePath}"`, { cwd: workspace, encoding: "utf-8", timeout: 10_000, stdio: ["pipe", "pipe", "pipe"] }).trim();
          } catch (e: any) { diff = e.stdout?.toString() || ""; }
        }
      } else {
        try {
          diff = execSync(`git -c core.quotePath=false diff HEAD -- "${filePath}"`, { cwd: workspace, encoding: "utf-8", timeout: 10_000, stdio: ["pipe", "pipe", "pipe"] }).trim();
        } catch (e: any) { diff = e.stdout?.toString() || ""; }
      }
      return c.json({ path: filePath, diff });
    } catch {
      return c.json({ path: filePath, diff: "" });
    }
  });

  // ── Git: status (for editor file tree badges) ──────────────────────
  app.get("/api/git/status", (c) => {
    try {
      const output = execSync("git -c core.quotePath=false status --porcelain", { cwd: workspace, encoding: "utf-8", timeout: 10_000, stdio: ["pipe", "pipe", "pipe"] }).trimEnd();
      const statuses: Record<string, string> = {};
      for (const line of output.split("\n").filter(Boolean)) {
        const status = line.substring(0, 2).trim();
        let filePath = line.substring(3);
        // Git wraps paths containing special chars in quotes — strip them
        if (filePath.startsWith('"') && filePath.endsWith('"')) {
          filePath = filePath.slice(1, -1);
        }
        if (status === "??" || status === "A") statuses[filePath] = "A";
        else if (status === "D") statuses[filePath] = "D";
        else statuses[filePath] = "M";
      }
      return c.json({ statuses });
    } catch {
      return c.json({ statuses: {} });
    }
  });

  // ── Process management ──────────────────────────────────────────────
  app.get("/api/processes/system", (c) => {
    // lsof/ps are Unix-only — graceful degrade on Windows
    if (isWin) return c.json({ processes: [] });

    const DEV_COMMANDS = new Set(["node", "bun", "deno", "python", "python3", "uvicorn", "vite", "next", "nuxt", "webpack", "esbuild", "tsx"]);
    const EXCLUDE_COMMANDS = new Set(["launchd", "nginx", "docker", "dockerd", "com.docker", "Cursor", "cursor", "Code", "code"]);
    const processes: { pid: number; command: string; fullCommand: string; ports: number[]; cwd?: string; startedAt?: number }[] = [];
    try {
      const lsofOutput = execSync("lsof -iTCP -sTCP:LISTEN -P -n", { encoding: "utf-8", timeout: 10_000, stdio: ["pipe", "pipe", "pipe"] });
      const pidPorts = new Map<number, Set<number>>();
      const pidCommand = new Map<number, string>();
      for (const line of lsofOutput.split("\n").slice(1)) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 9) continue;
        const cmd = parts[0];
        const pid = parseInt(parts[1], 10);
        if (isNaN(pid)) continue;
        if (EXCLUDE_COMMANDS.has(cmd)) continue;
        if (!DEV_COMMANDS.has(cmd)) continue;
        pidCommand.set(pid, cmd);
        // lsof NAME field is "addr:port (LISTEN)" — port is in the second-to-last field
        const nameField = parts.length >= 10 ? parts[parts.length - 2] : parts[parts.length - 1];
        const portMatch = nameField.match(/:(\d+)$/);
        if (portMatch) {
          if (!pidPorts.has(pid)) pidPorts.set(pid, new Set());
          pidPorts.get(pid)!.add(parseInt(portMatch[1], 10));
        }
      }
      for (const [pid, ports] of pidPorts) {
        let fullCommand = "";
        let cwd: string | undefined;
        try { fullCommand = execSync(`ps -p ${pid} -o args=`, { encoding: "utf-8", timeout: 3_000 }).trim(); } catch { }
        try {
          const cwdOutput = execSync(`lsof -a -p ${pid} -d cwd -Fn`, { encoding: "utf-8", timeout: 3_000 });
          const cwdMatch = cwdOutput.match(/\nn(.+)/);
          if (cwdMatch) cwd = cwdMatch[1];
        } catch { }
        processes.push({
          pid,
          command: pidCommand.get(pid) || "",
          fullCommand,
          ports: Array.from(ports),
          cwd,
        });
      }
    } catch { /* lsof not available or failed */ }
    return c.json({ processes });
  });

  app.post("/api/processes/:taskId/kill", async (c) => {
    const taskId = c.req.param("taskId");
    // taskId must be a numeric PID — reject anything else to prevent command injection
    const pid = parseInt(taskId, 10);
    if (isNaN(pid) || pid <= 0 || String(pid) !== taskId) {
      return c.json({ error: "Invalid taskId — must be a numeric PID" }, 400);
    }
    if (pid === process.pid) return c.json({ error: "Cannot kill self" }, 403);
    try {
      process.kill(pid);
    } catch { /* process may already be gone */ }
    return c.json({ ok: true, taskId });
  });

  app.post("/api/processes/system/:pid/kill", async (c) => {
    const pid = parseInt(c.req.param("pid"), 10);
    if (isNaN(pid) || pid <= 0) return c.json({ error: "Invalid PID" }, 400);
    if (pid === process.pid) return c.json({ error: "Cannot kill self" }, 403);
    try { process.kill(pid); } catch { /* already gone */ }
    return c.json({ ok: true, pid });
  });

  // ── Terminal management ──────────────────────────────────────────────
  app.post("/api/terminal/spawn", async (c) => {
    const body = await c.req.json<{ cwd?: string; cols?: number; rows?: number }>();
    const cwd = body.cwd || workspace;
    const terminalId = terminalManager.spawn(cwd, body.cols, body.rows);
    return c.json({ terminalId });
  });

  app.get("/api/terminal", (c) => {
    const terminalId = c.req.query("terminalId");
    const info = terminalManager.getInfo(terminalId);
    if (info) {
      return c.json({ active: true, terminalId: info.id, cwd: info.cwd });
    }
    return c.json({ active: false });
  });

  app.post("/api/terminal/kill", async (c) => {
    const body = await c.req.json<{ terminalId?: string }>();
    terminalManager.kill(body.terminalId);
    return c.json({ ok: true });
  });

  // ── Mode Maker routes (conditional) ──────────────────────────────────
  let modeMakerCleanup: (() => void) | undefined;
  if (options.modeName === "mode-maker" && options.projectRoot) {
    modeMakerCleanup = registerModeMakerRoutes(app, {
      workspace,
      projectRoot: options.projectRoot,
      isDev: !options.distDir,
    });
  }

  // ── Evolution routes (conditional) ──────────────────────────────────
  // Both `evolve` (per-mode personal) and `project-evolve` (project-scoped)
  // share the proposals → review → apply dashboard plumbing. Distinct
  // skills + targets, identical wire protocol.
  if (options.modeName === "evolve" || options.modeName === "project-evolve") {
    registerEvolutionRoutes(app, { workspace, stateDir: options.stateDir });
  }

  // ── Reverse proxy for viewer API access ────────────────────────────────
  app.all("/proxy/*", createProxyMiddleware(proxyConfigRef));

  // ── Static content serving (workspace files) ──────────────────────────
  // CORS needed for slide thumbnail capture: Vite dev server (different port)
  // fetches images via inlineImagesInHtml() before passing to snapdom.
  app.use("/content/*", cors({ origin: "*" }));
  app.get("/content/*", async (c) => {
    const relPath = decodeURIComponent(c.req.path.replace(/^\/content\//, ""));
    if (!relPath) return c.text("Not found", 404);
    // In replay mode, serve from replay-checkout dir (clean per-checkpoint state)
    const stateDirForContent = options.stateDir ?? join(workspace, ".pneuma");
    const contentRoot = serverReplayMode
      ? join(stateDirForContent, "replay-checkout")
      : workspace;
    const absPath = join(contentRoot, relPath);
    // Basic path traversal protection
    if (!pathStartsWith(absPath, contentRoot)) {
      return c.text("Forbidden", 403);
    }
    if (!existsSync(absPath)) {
      return c.text("Not found", 404);
    }
    // Bun.file() fails on directories / non-regular files on macOS
    try {
      const stat = statSync(absPath);
      if (!stat.isFile()) return c.text("Not found", 404);
    } catch {
      return c.text("Not found", 404);
    }
    try {
      const file = Bun.file(absPath);
      const size = file.size;
      const contentType = file.type || "application/octet-stream";

      // Support Range requests (needed for video seeking)
      const rangeHeader = c.req.header("range");
      if (rangeHeader) {
        const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
        if (match) {
          const start = parseInt(match[1], 10);
          const end = match[2] ? parseInt(match[2], 10) : size - 1;
          const chunkSize = end - start + 1;
          return new Response(file.slice(start, end + 1), {
            status: 206,
            headers: {
              "Content-Type": contentType,
              "Content-Range": `bytes ${start}-${end}/${size}`,
              "Content-Length": String(chunkSize),
              "Accept-Ranges": "bytes",
            },
          });
        }
      }

      return new Response(file, {
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(size),
          "Accept-Ranges": "bytes",
        },
      });
    } catch {
      return c.text("Error reading file", 500);
    }
  });

  // ── External mode bundle serving (production) ───────────────────────
  if (options.modeBundleDir) {
    const bundleDir = options.modeBundleDir;

    // Vendor shims — re-export React from window globals set by main bundle
    const REACT_SHIM = `const R = window.__PNEUMA_REACT__;
export default R;
export const { useState, useEffect, useCallback, useMemo, useRef, useContext, createContext, forwardRef, memo, Fragment, createElement, cloneElement, Children, isValidElement, Component, PureComponent, Suspense, lazy, startTransition, useTransition, useDeferredValue, useId, useSyncExternalStore, useImperativeHandle, useLayoutEffect, useDebugValue, useReducer } = R;`;

    const JSX_RUNTIME_SHIM = `const J = window.__PNEUMA_JSX_RUNTIME__;
export const { jsx, jsxs, Fragment } = J;`;

    // Bun.build uses jsx-dev-runtime (jsxDEV) due to a Bun v1.3+ regression.
    // jsxDEV(type, props, key, isStatic, source, self) is signature-compatible
    // with jsx(type, props, key) — extra dev args are simply ignored.
    const JSX_DEV_RUNTIME_SHIM = `const J = window.__PNEUMA_JSX_RUNTIME__;
export const jsxDEV = J.jsx;
export const Fragment = J.Fragment;`;

    app.get("/vendor/react.js", (c) => new Response(REACT_SHIM, { headers: { "Content-Type": "application/javascript" } }));
    // react-dom exports forwarded to published mode bundles. Keep in sync
    // with what react-dom actually exports — missing an export here causes
    // a runtime SyntaxError when a bundle imports it (since this shim is
    // an ES module, any named import that isn't re-exported fails hard).
    // unstable_batchedUpdates in particular is still pulled in by @dnd-kit
    // and a few other deps; React 18+ auto-batches so a fallback identity
    // shim is safe if the runtime ever stops providing it.
    const REACT_DOM_SHIM = `const RD = window.__PNEUMA_REACT_DOM__;
export default RD;
export const { createPortal, flushSync, createRoot, hydrateRoot, version } = RD;
export const unstable_batchedUpdates = RD.unstable_batchedUpdates || ((fn, ...args) => fn(...args));`;
    app.get("/vendor/react-dom.js", (c) => new Response(REACT_DOM_SHIM, { headers: { "Content-Type": "application/javascript" } }));
    app.get("/vendor/react-jsx-runtime.js", (c) => new Response(JSX_RUNTIME_SHIM, { headers: { "Content-Type": "application/javascript" } }));
    app.get("/vendor/react-jsx-dev-runtime.js", (c) => new Response(JSX_DEV_RUNTIME_SHIM, { headers: { "Content-Type": "application/javascript" } }));

    // Host store shim — re-exports `useStore` from the HOST's single Zustand
    // instance. Without this, Bun.build inlines the entire src/store.ts
    // tree into every published mode bundle, and the mode ends up with its
    // own parallel store that never talks to the host. The visible symptom
    // is anything that crosses the mode/host boundary (activeContentSet,
    // activeFile, selection) silently failing because writes go to the
    // mode's bundled copy while the host reads from its own.
    const PNEUMA_STORE_SHIM = `const S = window.__PNEUMA_STORE__;
if (!S) throw new Error("__PNEUMA_STORE__ not set — pneuma-skills host didn't expose useStore before loading the mode bundle");
export const useStore = S;
export default S;`;
    app.get("/vendor/pneuma-store.js", (c) => new Response(PNEUMA_STORE_SHIM, { headers: { "Content-Type": "application/javascript" } }));

    // Serve compiled mode bundle (JS + CSS)
    app.get("/mode-assets/*", async (c) => {
      const relPath = c.req.path.replace("/mode-assets/", "");
      const filePath = join(bundleDir, relPath);
      const file = Bun.file(filePath);
      if (await file.exists()) {
        const contentType = relPath.endsWith(".css")
          ? "text/css"
          : "application/javascript";
        return new Response(file, { headers: { "Content-Type": contentType } });
      }
      return c.notFound();
    });
  }

  // ── Built frontend serving (production) ─────────────────────────────
  if (options.distDir) {
    const distDir = options.distDir;
    const hasModeBundleDir = !!options.modeBundleDir;

    // Serve static assets (JS/CSS bundles + public files like logo.png, favicon)
    // Skip paths handled by dedicated routes (/content/*, /api/*, /ws/*, /export/*)
    app.get("*", async (c, next) => {
      const p = c.req.path;
      if (p.startsWith("/content/") || p.startsWith("/api/") || p.startsWith("/ws/") || p.startsWith("/export/")) {
        return next();
      }
      const filePath = join(distDir, p);
      const file = Bun.file(filePath);
      if (await file.exists() && !p.endsWith("/")) return new Response(file);
      return next();
    });

    // SPA fallback — serve index.html for all non-API/content routes
    // When external mode bundle exists, inject importmap for React resolution
    app.get("*", async (c, next) => {
      const p = c.req.path;
      if (p.startsWith("/content/") || p.startsWith("/api/") || p.startsWith("/ws/") || p.startsWith("/export/")) {
        return next();
      }
      let html = await Bun.file(join(distDir, "index.html")).text();

      if (hasModeBundleDir) {
        const importMap = `<script type="importmap">
{"imports":{"react":"/vendor/react.js","react-dom":"/vendor/react-dom.js","react/jsx-runtime":"/vendor/react-jsx-runtime.js","react/jsx-dev-runtime":"/vendor/react-jsx-dev-runtime.js","pneuma-skills/src/store.js":"/vendor/pneuma-store.js","pneuma-skills/src/store.ts":"/vendor/pneuma-store.js"}}
</script>`;
        // Inject <link> tags for any CSS files produced by Bun.build()
        let cssLinks = "";
        try {
          const bundleDir = options.modeBundleDir!;
          const { readdirSync } = await import("node:fs");
          const cssFiles = readdirSync(bundleDir).filter((f: string) => f.endsWith(".css"));
          cssLinks = cssFiles.map((f: string) => `<link rel="stylesheet" href="/mode-assets/${f}">`).join("\n");
        } catch { /* no CSS files or dir read failed */ }
        html = html.replace("<head>", `<head>\n${importMap}\n${cssLinks}`);
      }

      return new Response(html, { headers: { "Content-Type": "text/html" } });
    });
  }

  // ── Bun.serve with WebSocket ──────────────────────────────────────────
  const MAX_PORT_ATTEMPTS = 10;
  let serverPort = port;
  let server!: ReturnType<typeof Bun.serve<SocketData>>;

  for (let attempt = 0; attempt < MAX_PORT_ATTEMPTS; attempt++) {
    try {
      server = Bun.serve<SocketData>({
        port: serverPort,
        hostname: "0.0.0.0",
        async fetch(req, server) {
          const url = new URL(req.url);

          // CLI WebSocket — Claude Code CLI connects here via --sdk-url
          const cliMatch = url.pathname.match(/^\/ws\/cli\/([a-zA-Z0-9_-]+)$/);
          if (cliMatch) {
            const sessionId = cliMatch[1];
            const upgraded = server.upgrade(req, {
              data: { kind: "cli" as const, sessionId },
            });
            if (upgraded) return undefined;
            return new Response("WebSocket upgrade failed", { status: 400 });
          }

          // Browser WebSocket — connects to a specific session
          const browserMatch = url.pathname.match(/^\/ws\/browser\/([a-zA-Z0-9_-]+)$/);
          if (browserMatch) {
            const sessionId = browserMatch[1];
            const upgraded = server.upgrade(req, {
              data: { kind: "browser" as const, sessionId },
            });
            if (upgraded) return undefined;
            return new Response("WebSocket upgrade failed", { status: 400 });
          }

          // Terminal WebSocket — connects to a PTY terminal
          const terminalMatch = url.pathname.match(/^\/ws\/terminal\/([a-f0-9-]+)$/);
          if (terminalMatch) {
            const terminalId = terminalMatch[1];
            const upgraded = server.upgrade(req, {
              data: { kind: "terminal" as const, terminalId },
            });
            if (upgraded) return undefined;
            return new Response("WebSocket upgrade failed", { status: 400 });
          }

          // Hono handles the rest
          return app.fetch(req, server);
        },
        websocket: {
          maxPayloadLength: 64 * 1024 * 1024, // 64 MB — safety net for large file attachments
          open(ws: ServerWebSocket<SocketData>) {
            const data = ws.data;
            if (data.kind === "cli") {
              wsBridge.handleCLIOpen(ws, data.sessionId);
            } else if (data.kind === "browser") {
              wsBridge.handleBrowserOpen(ws, data.sessionId);
            } else if (data.kind === "terminal") {
              terminalManager.addBrowserSocket(ws as ServerWebSocket<TerminalSocketData>);
            }
          },
          message(ws: ServerWebSocket<SocketData>, msg: string | Buffer) {
            const data = ws.data;
            if (data.kind === "cli") {
              wsBridge.handleCLIMessage(ws, msg);
            } else if (data.kind === "browser") {
              wsBridge.handleBrowserMessage(ws, msg);
            } else if (data.kind === "terminal") {
              terminalManager.handleBrowserMessage(ws as ServerWebSocket<TerminalSocketData>, msg);
            }
          },
          close(ws: ServerWebSocket<SocketData>) {
            const data = ws.data;
            if (data.kind === "cli") {
              wsBridge.handleCLIClose(ws);
            } else if (data.kind === "browser") {
              wsBridge.handleBrowserClose(ws);
            } else if (data.kind === "terminal") {
              terminalManager.removeBrowserSocket(ws as ServerWebSocket<TerminalSocketData>);
            }
          },
        },
      });
      break; // success
    } catch (err: any) {
      if (err?.code === "EADDRINUSE") {
        console.log(`[server] Port ${serverPort} is in use, trying ${serverPort + 1}...`);
        serverPort++;
      } else {
        throw err;
      }
    }
  }

  console.log(`[server] Pneuma server running on http://localhost:${serverPort}`);
  console.log(`[server] Workspace: ${workspace}`);
  console.log(`[server] CLI WebSocket:     ws://localhost:${serverPort}/ws/cli/:sessionId`);
  console.log(`[server] Browser WebSocket: ws://localhost:${serverPort}/ws/browser/:sessionId`);

  const onReplayContinue = (cb: () => Promise<void>) => {
    replayContinueCallback = cb;
  };
  const onEditingLaunch = (cb: () => Promise<void>) => { editingLaunchCallback = cb; };
  const onEditingKill = (cb: () => Promise<void>) => { editingKillCallback = cb; };

  const cleanup = async () => {
    if (handoffRoutesContext) handoffRoutesContext.stop();
    await hookBus.emit("session:end", { sessionId: sessionInfo.sessionId, mode: sessionInfo.mode, workspace }, sessionInfo).catch(() => {});
    // Tear down chokidar watchers so they don't leak across `bun run dev`
    // restarts (each restart spawns a fresh server process; without this,
    // the process exit alone reaps them, but explicit shutdown lets
    // tests clean up between cases).
    await shutdownProjectCache().catch(() => {});
  };

  return { server, wsBridge, terminalManager, port: serverPort, modeMakerCleanup, onReplayContinue, onEditingLaunch, onEditingKill, cleanup, sessionInfo, hookBus, queueContentUpdate };
}
