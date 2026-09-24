import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, lstatSync, unlinkSync, mkdirSync, createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { join, resolve, relative, basename, dirname, sep } from "node:path";
import { execFileSync, execSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { WsBridge } from "./ws-bridge.js";
import { getBackendDescriptors, getDefaultBackendType, detectBackendAvailability } from "../backends/index.js";
import type { AgentBackendType } from "../core/types/agent-backend.js";
import type { SocketData } from "./ws-bridge.js";
import type { TerminalSocketData } from "./ws-bridge-types.js";
import type { ServerWebSocket } from "bun";
import { TerminalManager } from "./terminal-manager.js";
import { registerModeMakerRoutes } from "./mode-maker-routes.js";
import { HOST_ABI_VENDOR_SHIMS, hostAbiImportMap } from "../snapshot/mode-build.js";
import { registerEvolutionRoutes } from "./evolution-routes.js";
import { openPath, revealPath, openUrl } from "./system-bridge.js";
import { pathStartsWith, isContained, isGitObjectId, isWin } from "./utils.js";
import { registerExportRoutes } from "./routes/export.js";
import { registerAssetFsRoutes } from "./routes/asset-fs.js";
import { registerSetupListing } from "./routes/setup-listing.js";
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
import { resolveLocalized, type ModeManifest, type ProxyRoute } from "../core/types/mode-manifest.js";
import type { ModeCatalogEntry, ModeInstallState } from "../core/types/mode-catalog.js";
import { bundledModeNames, listCatalogModes, resolveCatalogMode } from "../core/mode-catalog.js";
import { startProxyWatcher, registerSelfWrite, registerSelfDelete } from "./file-watcher.js";
import type { WorkspaceWatcher } from "./watch/index.js";
import { applySeedPlan, planSeedEntry, resolveSeedCatalog, runPostSeedInstall, SeedContainmentError, type SeedCopyPlan } from "./seed-installer.js";
import { mountHandoffRoutes } from "./handoff-routes.js";
import { mountBorrowRoutes } from "./borrow-routes.js";
import { enumerateLocalModes } from "../core/local-modes.js";
import { registerLibraryRoutes } from "./library-routes.js";
import { registerCatalogRoutes } from "./catalog-routes.js";
import {
  registerAgentCommandRoutes,
  bootstrapAutoUpdate as bootstrapAgentCommandAutoUpdate,
} from "./agent-command-routes.js";
import { mountNativeRoutes } from "./native-bridge.js";
import { mountProjectsRoutes } from "./projects-routes.js";
import {
  primeRegisteredProjects,
  revalidateProjectCache,
  shutdownProjectCache,
} from "./projects-cache.js";
import { bindFirstFreePort } from "./bind-port.js";
import { loadProjectManifest } from "../core/project-loader.js";
import {
  readSessionsFileSync,
  writeSessionsFileSync,
  upsertSession,
  type AnySessionRegistryEntry,
  type SessionsFile,
} from "../bin/sessions-registry.js";
import { readRunning, removeRunning } from "../bin/running-registry.js";

const DEFAULT_PORT = 17007;
/** Consecutive ports tried from the requested one before startup fails. */
const MAX_PORT_ATTEMPTS = 10;

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
  /**
   * Full manifest of the running mode. Read by per-session routes that
   * need declarative data (e.g. the empty-state gallery's seed catalog
   * and mode intro). Optional so launcher mode (no mode loaded) and
   * minimal tests can still call `startServer`.
   */
  modeManifest?: ModeManifest;
  /**
   * Mode package directory — `<PROJECT_ROOT>/modes/<name>` for builtins,
   * the external mode's root for non-builtins. Used to locate per-mode
   * assets (showcase art, seed-gallery thumbnails). Distinct from
   * `seedBase` below: builtin manifests' `init.seedFiles` keys still
   * carry the `modes/<name>/` prefix, so seed copy roots one level up.
   */
  modeSourceDir?: string;
  /**
   * Filesystem root for resolving `init.seedFiles` source keys —
   * `PROJECT_ROOT` for builtins (whose keys are like
   * `"modes/slide/seed/..."`), the mode package directory for
   * externals. A future cleanup can collapse this into `modeSourceDir`
   * once all builtin manifests use mode-relative seed paths.
   */
  seedBase?: string;
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
  /**
   * The session's workspace watcher (`server/file-watcher.ts::createSessionWatcher`),
   * owned by the caller for the life of the process (`bin/pneuma.ts` leaves it
   * to process exit). The server hot-reloads `proxy.json` from
   * it and reports its health as `GET /api/session` → `watcher`. Absent
   * (launcher, evolve, tests): `proxy.json` is read once at start and
   * `watcher` is null.
   */
  workspaceWatcher?: WorkspaceWatcher;
}

/**
 * The Pneuma project root implied by a workspace path, or undefined.
 *
 * `/api/launch/prepare` accepts an optional `workspace` so a parameter whose
 * options are discovered under `<projectRoot>/.pneuma/...` can be answered
 * before any session exists (the empty-shell launch sheet). A workspace that
 * is not a project — or a path that cannot be read — simply yields nothing,
 * which is exactly what a quick session should see.
 */
async function pneumaProjectRootFor(workspace?: string): Promise<string | undefined> {
  if (!workspace || workspace.trim().length === 0) return undefined;
  try {
    const resolved = resolve(workspace.replace(/^~/, homedir()));
    const { detectWorkspaceKind } = await import("../core/project-loader.js");
    return (await detectWorkspaceKind(resolved)) === "project" ? resolved : undefined;
  } catch {
    return undefined;
  }
}

/** One resolved byte range, or a refusal. */
type RangeSpec =
  | { kind: "full" }
  | { kind: "partial"; start: number; end: number }
  | { kind: "unsatisfiable" };

/**
 * Parse one RFC 9110 `Range` header against a known file size.
 *
 * Only single `bytes` ranges are honoured; a multi-range request or an
 * unknown unit falls back to `full`, which is explicitly allowed ("a
 * server MAY ignore the Range header field") and which no media element
 * ever needs. `end` is INCLUSIVE, as the wire format is — callers slicing
 * with an exclusive end must add one.
 *
 * Exported for the tests: the inclusive/exclusive boundary is exactly
 * where this kind of code goes wrong.
 */
export function parseByteRange(header: string | null | undefined, size: number): RangeSpec {
  if (!header) return { kind: "full" };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return { kind: "full" };
  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return { kind: "full" };
  if (size === 0) return { kind: "unsatisfiable" };
  let start: number;
  let end: number;
  if (rawStart === "") {
    // Suffix form `bytes=-N`: the LAST n bytes, clamped to the whole file.
    const suffix = Number(rawEnd);
    if (suffix === 0) return { kind: "unsatisfiable" };
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    // Open form `bytes=N-` runs to the last byte; a stated end past the
    // last byte is clamped rather than refused (RFC 9110 §14.1.1).
    end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { kind: "full" };
  if (start >= size || start > end) return { kind: "unsatisfiable" };
  return { kind: "partial", start, end };
}

/**
 * Mount the `GET /api/file?path=<abs>` route — serves a single file by
 * absolute path, gated by a workspace-containment check (path-traversal
 * guard). Used by the chat's inline image previews to fetch a workspace
 * file the agent read. Factored out of `startServer` so it can be unit
 * tested against a bare `new Hono()`.
 *
 * It also serves every MEDIA file a viewer plays (bansho's pre-mixed
 * narration track, its per-clip audio), and that makes byte ranges load
 * bearing rather than polite. Chromium marks a response streaming when the
 * server neither advertises `Accept-Ranges` nor answers `Range` with a
 * 206 — and for a streaming source of finite duration `Seekable()` reports
 * `[0, 0]`, which the HTML seek algorithm then clamps every `currentTime`
 * write into. Measured before this route grew ranges: a seek to 111.6s on
 * a fully buffered 222s track read back 0.0s, so the narration replayed
 * from the opening word after every scrub. A stated `content-length` is
 * half of the same fix — a chunked body has no known size, which is by
 * itself enough to mark the source streaming.
 */
/**
 * Most a single partial response will hold in memory.
 *
 * Sub-ranges cannot be streamed here: `Response(BunFile.slice(a, b)).body`
 * read as a STREAM ignores the slice's end and runs to EOF (measured: a
 * 101-byte range arrived as 924 bytes), and `cors()` re-wraps every
 * response as `new Response(res.body, res)` — so the only way to send
 * exactly the requested bytes through this stack is to hold them. A server
 * may always answer with a SHORTER range than was asked for (RFC 9110
 * §14.4); the client simply asks for the rest, which is how every CDN
 * serves large media. The whole-file case is exempt — it streams the
 * unsliced file and costs nothing.
 */
const MAX_RANGE_CHUNK = 8 * 1024 * 1024;

export function mountFileRoute(
  app: Hono,
  opts: { workspace: string; maxRangeChunk?: number },
): void {
  const workspaceRoot = resolve(opts.workspace);
  const maxChunk = opts.maxRangeChunk ?? MAX_RANGE_CHUNK;
  app.get("/api/file", async (c) => {
    const rel = c.req.query("path");
    if (!rel) return c.json({ error: "missing path" }, 400);
    // Anchor relative paths to the workspace, NOT process.cwd() — the server
    // process isn't chdir'd into the workspace (only the agent backend is, see
    // bin/pneuma.ts), so a workspace-relative path like a cosmos excerpt's
    // `.cosmos-assets/<id>/x.png` must resolve against the workspace root to
    // be found. Absolute paths pass through unchanged (resolve ignores the
    // base when the second arg is absolute), preserving chat image previews.
    // This also matches how the static player's service worker resolves
    // `/api/file` against workspace-relative package blob keys.
    const abs = resolve(workspaceRoot, rel);
    if (!isContained(abs, workspaceRoot)) {
      return c.json({ error: "path escapes workspace" }, 403);
    }
    if (!existsSync(abs)) return c.json({ error: "not found" }, 404);
    let size: number;
    try {
      const stat = statSync(abs);
      if (!stat.isFile()) return c.json({ error: "not a file" }, 400);
      size = stat.size;
    } catch {
      return c.json({ error: "stat failed" }, 500);
    }
    const file = Bun.file(abs);
    const type = file.type || "application/octet-stream";
    const base = {
      "content-type": type,
      "cache-control": "private, max-age=60",
      // Said on EVERY response, not just partial ones: it is what tells a
      // media element the resource is seekable in the first place.
      "accept-ranges": "bytes",
    };
    const range = parseByteRange(c.req.header("range"), size);
    if (range.kind === "unsatisfiable") {
      return new Response(null, {
        status: 416,
        headers: { ...base, "content-range": `bytes */${size}` },
      });
    }
    if (range.kind === "partial") {
      const { start } = range;
      const whole = start === 0 && range.end === size - 1;
      // Served range, which may be shorter than the asked-for one. The
      // whole-file case is exempt from the cap: it is how Chromium opens
      // every media resource (`Range: bytes=0-`), and capping it would
      // turn one request into hundreds.
      const end = whole ? range.end : Math.min(range.end, start + maxChunk - 1);
      const headers = {
        ...base,
        "content-range": `bytes ${start}-${end}/${size}`,
        "content-length": String(end - start + 1),
      };
      // Unsliced: no end bound for the stream to lose, and nothing held.
      if (whole) return new Response(file, { status: 206, headers });
      // `end` is inclusive on the wire and exclusive in `slice`.
      return new Response(await file.slice(start, end + 1).arrayBuffer(), {
        status: 206,
        headers,
      });
    }
    return new Response(file, {
      headers: { ...base, "content-length": String(size) },
    });
  });
}

/**
 * Static workspace content at `/content/*` — the URL space every viewer's
 * assets live in (clipcraft media, slide images, cosmos excerpts).
 *
 * Split out of startServer so it can be mounted against a bare Hono app in
 * tests, the way mountFileRoute already is. Behavior is unchanged apart from
 * the validators documented below.
 */
export function mountContentRoute(
  app: Hono,
  opts: { contentRoot: string },
): void {
  const contentRoot = opts.contentRoot;
  app.get("/content/*", async (c) => {
    let relPath: string;
    try {
      relPath = decodeURIComponent(c.req.path.replace(/^\/content\//, ""));
    } catch {
      return c.text("Bad request: malformed percent-encoding", 400);
    }
    if (relPath.includes("\0")) return c.text("Bad request", 400);
    let absPath = join(contentRoot, relPath);
    // Containment by whole path components and after resolving symlinks: an
    // encoded `../<root>-neighbor/` or a symlink to outside is refused.
    if (!isContained(absPath, contentRoot)) {
      return c.text("Forbidden", 403);
    }
    if (!existsSync(absPath)) {
      return c.text("Not found", 404);
    }
    // Bun.file() fails on directories / non-regular files on macOS
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(absPath);
      if (stat.isDirectory()) {
        // A directory URL serves its index.html, as a static host does — a
        // page's `<a href="./">` must land where it lands once deployed.
        // Without the trailing slash, relative URLs inside the page would
        // resolve one level up, so redirect to the slashed URL first.
        const index = join(absPath, "index.html");
        if (!isContained(index, contentRoot)) return c.text("Forbidden", 403);
        if (!existsSync(index) || !statSync(index).isFile()) return c.text("Not found", 404);
        if (!c.req.path.endsWith("/")) {
          const query = new URL(c.req.url).search;
          return c.redirect(`${c.req.path}/${query}`, 301);
        }
        absPath = index;
        stat = statSync(index);
      }
      if (!stat.isFile()) return c.text("Not found", 404);
    } catch {
      return c.text("Not found", 404);
    }
    // Validators. Without one, a browser cannot reuse anything it already
    // holds, so every consumer of the same asset re-downloads it in full.
    // Measured on a clipcraft session start (five media files, 6.5 MB
    // distinct): the server sent 42.67 MB across 30 responses, because the
    // playback engine's decode, the waveform, the frame strip, the 3D view
    // and the preview each fetch the same URL independently. With these
    // headers the same load is 17.75 MB, 21 of 31 requests answered 304.
    //
    // `no-cache` rather than a max-age: an agent can regenerate an asset at
    // any moment, so the bytes are bought back with a revalidation and never
    // with a window in which the viewer shows something stale. The ETag is
    // strong (no `W/`) because a weak validator cannot be used to validate a
    // Range request, and media is fetched almost entirely by range.
    const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
    const validators = {
      ETag: etag,
      "Last-Modified": new Date(stat.mtimeMs).toUTCString(),
      "Cache-Control": "no-cache",
    };
    // Evaluated before Range, per RFC 9110 §13.2.2.
    const ifNoneMatch = c.req.header("if-none-match");
    if (
      ifNoneMatch &&
      ifNoneMatch
        .split(",")
        .map((t) => t.trim())
        .some((t) => t === etag || t === "*")
    ) {
      return new Response(null, { status: 304, headers: validators });
    }
    try {
      const file = Bun.file(absPath);
      const size = file.size;
      const contentType = file.type || "application/octet-stream";

      // Support Range requests (needed for video seeking).
      //
      // The body is a Node read stream over the byte window, not
      // `file.slice(start, end + 1)`. A sliced Bun.file() is the right size
      // as a Blob body, but on Bun 1.4.0 `.stream()` on that slice yields
      // the whole file — and every middleware that re-wraps the response
      // (`new Response(res.body, …)`; the CORS layer in front of this route
      // does) reads the body as a stream. The browser then got a 206 whose
      // body contradicted Content-Range and refused the media outright.
      // No Content-Length: Bun sends a stream body chunked and drops an
      // explicit length; Content-Range already carries the total.
      const rangeHeader = c.req.header("range");
      if (rangeHeader) {
        const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
        if (match) {
          const start = parseInt(match[1], 10);
          const end = Math.min(match[2] ? parseInt(match[2], 10) : size - 1, size - 1);
          if (start > end) {
            return new Response(null, {
              status: 416,
              headers: { ...validators, "Content-Range": `bytes */${size}` },
            });
          }
          // node:stream/web and the DOM ReadableStream types disagree on
          // getReader() overloads; the runtime object is one and the same.
          const body = Readable.toWeb(createReadStream(absPath, { start, end })) as unknown as ReadableStream;
          return new Response(body, {
            status: 206,
            headers: {
              ...validators,
              "Content-Type": contentType,
              "Content-Range": `bytes ${start}-${end}/${size}`,
              "Accept-Ranges": "bytes",
            },
          });
        }
      }

      return new Response(file, {
        headers: {
          ...validators,
          "Content-Type": contentType,
          "Content-Length": String(size),
          "Accept-Ranges": "bytes",
        },
      });
    } catch {
      return c.text("Error reading file", 500);
    }
  });
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
    /**
     * Background hint for borrow sub-sessions (design §6.2). On desktop this
     * keeps B's window hidden and suppresses the reveal-on-idle the normal
     * handoff path uses — the user's foreground stays on host A. The server
     * spawn itself is unchanged (always `--no-prompt --no-open`); the desktop
     * presentation layer reads this. Passed through to the child URL so the
     * Electron shell can honor it.
     */
    background?: boolean;
    /**
     * Borrow id when spawning a borrow target B (design §5). Threaded to the
     * child as `--borrow <id>` so B's `bin/pneuma.ts` stamps `session.json`
     * with `{ internal: true, borrow: {...} }` (filtering it from user-facing
     * lists) and dispatches `<pneuma:env reason="borrow" />` instead of a
     * terminal `handed-off`. Undefined for every non-borrow launch.
     */
    borrowId?: string;
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
    if (params.borrowId) args.push("--borrow", params.borrowId);
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
    // immediately instead of waiting on the project watcher. Fire-
    // and-forget — the launch response shouldn't block on the scan.
    if (params.project) {
      revalidateProjectCache(params.project).catch(() => {});
    }

    // Tag the URL for a background (borrow) sub-session so the desktop shell
    // can run it hidden and skip the reveal-on-idle (design §6.2). Harmless on
    // web — no Electron window to hide. Append defensively (the child URL may
    // already carry a query string).
    let url = readyUrl;
    if (params.background) {
      url += (url.includes("?") ? "&" : "?") + "background=1";
    }

    return { url, workspace: resolvedWorkspace, sessionId: resolvedSessionId };
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

  /**
   * Compat status for a mode entry — surfaced to the launcher so the UI
   * can mark incompatible modes (greyed card, lock badge, tooltip). The
   * shape matches `core/version-compat.ts`'s `CompatResult` so consumers
   * can re-use that module's helpers without re-deriving.
   */
  interface RegistryCompat {
    level: "match" | "minor-drift" | "major-drift" | "unknown";
    /** The declared range as written in the mode's `manifest.ts.pneumaVersion`. */
    declared: string | null;
    /** The running pneuma-skills version. Same value for every entry. */
    runtime: string;
    reason?: string;
  }

  /** Localized showcase payload shared by the `builtins` and `catalog` buckets. */
  interface RegistryShowcase {
    tagline?: string;
    hero?: string;
    highlights?: Array<{ title: string; description: string; media: string; mediaType?: string }>;
  }

  /**
   * One catalog mode as the launcher sees it before anything is downloaded:
   * the introduction copied into `modes/catalog.json` at pack time, the
   * `showcase/` images that stayed in the package, the install size, and
   * where this machine stands (`state`).
   *
   * A catalog mode that is present in the tree (a repo checkout) is NOT
   * listed here — it runs from source and is reported in `builtins`.
   */
  interface RegistryCatalogEntry {
    name: string;
    displayName: string;
    description?: string;
    icon?: string;
    /** The mode's own manifest version, as pinned by this core's catalog. */
    version: string;
    /** Bytes on disk after extraction — what the card quotes as the install size. */
    unpackedSize: number;
    /** Compressed archive bytes — the denominator the install stream counts to. */
    downloadSize: number;
    /** `not-installed` | `installed` | `stale` (installed from another core's build). */
    state: ModeInstallState;
    /**
     * Absolute path to the installed mode directory, present only while
     * `state === "installed"` and the source is actually on disk.
     *
     * Deliberately NOT called `path`: `local[]`'s `path` is a launch
     * specifier and a workspace the user may evolve in place, and a catalog
     * install is neither — `core/mode-catalog.ts` owns that directory and
     * deletes it on the next core upgrade. This field answers one question:
     * "where would a copy of this mode's source come from", which is what
     * "Edit in Mode Maker" needs since `modes/<name>/` does not exist for a
     * catalog mode in a released package.
     */
    installPath?: string;
    showcase?: RegistryShowcase;
  }

  interface RegistryResponse {
    /** Pneuma runtime version this server is running. Convenient for UI display. */
    runtimeVersion: string;
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
    /**
     * Locally installed modes. Covers two sources:
     * - `~/.pneuma/modes/<id>/` — single-mode external installs (legacy).
     * - `~/.pneuma/libraries/<id>/<mode>/` — modes inside a multi-mode
     *   library that the user has activated. These entries carry
     *   `librarySource` so the launcher can group them under a "Mode
     *   Libraries" section + render a source chip. Deactivated modes
     *   stay on disk but do not appear here.
     */
    local: Array<{
      name: string;
      displayName: string;
      description?: string;
      version: string;
      path: string;
      icon?: string;
      librarySource?: { id: string; name: string; displayName?: string };
      /** True when the library's recorded `manifestVersion` is ahead of `installedVersion` */
      updateAvailable?: boolean;
      /**
       * Declared `pneumaVersion` range on the mode (or falling back to the
       * parent library's `pneumaVersion`). Cached for the UI tooltip — the
       * launcher doesn't have to re-read the manifest just to render the
       * "Targets ^X.Y.0" line.
       */
      pneumaVersion?: string;
      /**
       * Pre-computed compat result against the running runtime. UI uses
       * `compat.level` to pick the rendering variant (incompatible/grey
       * for "major-drift", warning chip for "minor-drift", normal for
       * "match", normal for "unknown" — never punish modes that didn't
       * declare a range, only ones whose declaration disagrees with the
       * runtime).
       */
      compat?: RegistryCompat;
    }>;
    /**
     * Modes this core release knows about but does not ship — downloaded
     * from the CDN on first use. Empty on a core without a generated
     * catalog (a repo checkout), where every mode is in `builtins`.
     */
    catalog: RegistryCatalogEntry[];
  }

  const registryCache: Map<string, { value: RegistryResponse; fetchedAt: number }> = new Map();
  const registryInflight: Map<string, Promise<RegistryResponse>> = new Map();

  // Pick a locale from a value in a localized-string-or-plain JSON field.
  const pickLocalized = (value: unknown, locale: string): string | undefined => {
    if (value == null) return undefined;
    if (typeof value === "string") return value;
    if (typeof value !== "object") return undefined;
    const map = value as Record<string, unknown>;
    if (typeof map[locale] === "string") return map[locale] as string;
    if (typeof map.en === "string") return map.en as string;
    for (const v of Object.values(map)) {
      if (typeof v === "string" && v.length > 0) return v;
    }
    return undefined;
  };

  const localizeShowcase = (raw: unknown, locale: string): RegistryResponse["builtins"][number]["showcase"] | undefined => {
    if (!raw || typeof raw !== "object") return undefined;
    const data = raw as Record<string, unknown>;
    const out: NonNullable<RegistryResponse["builtins"][number]["showcase"]> = {};
    const tagline = pickLocalized(data.tagline, locale);
    if (tagline) out.tagline = tagline;
    if (typeof data.hero === "string") out.hero = data.hero;
    if (Array.isArray(data.highlights)) {
      out.highlights = data.highlights.map((h) => {
        const hi = h as Record<string, unknown>;
        return {
          title: pickLocalized(hi.title, locale) || "",
          description: pickLocalized(hi.description, locale) || "",
          media: typeof hi.media === "string" ? hi.media : "",
          ...(typeof hi.mediaType === "string" ? { mediaType: hi.mediaType } : {}),
        };
      });
    }
    return out;
  };

  /** A catalog entry joined with this machine's install state. */
  type CatalogModeListing = ModeCatalogEntry & { state: ModeInstallState };

  /**
   * Catalog modes as the launcher sees them before anything is downloaded.
   * `listCatalogModes` answers `[]` for a repo checkout (no generated
   * `modes/catalog.json`), where every mode is reachable from the tree and
   * belongs in `builtins` instead — an empty bucket here is the normal
   * development case, not a degraded one.
   */
  const loadCatalogListings = async (root: string): Promise<CatalogModeListing[]> =>
    listCatalogModes({ projectRoot: root });

  const buildRegistry = async (locale: string): Promise<RegistryResponse> => {
    const { parseManifestTs } = await import("../core/utils/manifest-parser.js");
    const { checkCompat } = await import("../core/version-compat.js");
    const projectRoot = options.projectRoot || resolve(dirname(import.meta.path), "..");

    // Runtime version — read once per build (small, cached upstream).
    let runtimeVersion = "0.0.0";
    try {
      const pkg = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf-8"));
      if (typeof pkg.version === "string") runtimeVersion = pkg.version;
    } catch { /* leave as 0.0.0; UI will fall back to "unknown" compat */ }

    // `builtins` = every mode whose source is present in this installation.
    // In a released package that is exactly the bundled set; in a repo
    // checkout it is every mode directory, because an in-tree catalog mode
    // runs from source with no network (proposal D8).
    //
    // The list is derived, never written here: the server must carry no
    // mode knowledge. Order = `modes/distribution.json` first (the modes
    // this distribution leads with), then the catalog's own order, then
    // anything left over alphabetically — so a new mode directory appears
    // without an edit to this file.
    //
    // Modes that exist on disk but should never be offered as a user choice
    // (evolve, project-evolve, project-onboard — all triggered by a specific
    // UI affordance or by Pneuma itself, never by "what mode would you like
    // to start?") declare `hidden: true` in their manifest and are filtered
    // out below. That flag is the only filter; nothing is excluded by being
    // absent from a list.
    const modesRoot = join(projectRoot, "modes");
    let onDiskModes: string[] = [];
    try {
      onDiskModes = readdirSync(modesRoot)
        .filter((dir) => existsSync(join(modesRoot, dir, "manifest.ts")))
        .sort();
    } catch { /* no modes dir (minimal test harness) — leave empty */ }

    const catalogListings = await loadCatalogListings(projectRoot);
    const declaredOrder = new Map<string, number>();
    // `bundledModeNames` reads `modes/distribution.json`, the one authority
    // for the split (see `core/types/mode-catalog.ts`). A malformed or missing
    // file degrades to "no declared order", which leaves the on-disk modes
    // alphabetical rather than hiding any of them.
    const declared = [...bundledModeNames({ projectRoot }), ...catalogListings.map((e) => e.name)];
    for (const name of declared) {
      if (!declaredOrder.has(name)) declaredOrder.set(name, declaredOrder.size);
    }
    const builtinNames = onDiskModes.slice().sort((a, b) => {
      const ai = declaredOrder.get(a);
      const bi = declaredOrder.get(b);
      if (ai !== undefined && bi !== undefined) return ai - bi;
      if (ai !== undefined) return -1;
      if (bi !== undefined) return 1;
      return a.localeCompare(b);
    });
    const builtins = builtinNames
      .map((name) => {
        const manifestPath = join(projectRoot, "modes", name, "manifest.ts");
        let parsed: ReturnType<typeof parseManifestTs> = {};
        try { parsed = parseManifestTs(readFileSync(manifestPath, "utf-8"), locale); } catch { }
        let showcase: RegistryResponse["builtins"][number]["showcase"] | undefined;
        try {
          const showcasePath = join(projectRoot, "modes", name, "showcase", "showcase.json");
          if (existsSync(showcasePath)) {
            const raw = JSON.parse(readFileSync(showcasePath, "utf-8"));
            showcase = localizeShowcase(raw, locale);
          }
        } catch { }
        return {
          name,
          displayName: parsed.displayName || name,
          description: parsed.description || "",
          icon: parsed.icon,
          version: "builtin",
          type: "builtin" as const,
          hidden: parsed.hidden === true,
          // Read out of the manifest, never a list of names here: a mode that
          // gains launch-time params says so in its own `init.params`.
          ...(parsed.hasInitParams ? { hasInitParams: true } : {}),
          ...(showcase ? { showcase } : {}),
          ...(parsed.inspiredBy ? { inspiredBy: parsed.inspiredBy } : {}),
        };
      })
      .filter((m) => !m.hidden)
      .map(({ hidden: _hidden, ...rest }) => rest); // strip the diagnostic field before serializing

    // Catalog bucket — the modes this release does not ship. An entry whose
    // source IS in the tree was already reported as a builtin above, so it
    // never shows up twice. Introduction and icon come from the catalog
    // (copied out of the manifest at pack time); the preview images come
    // from `modes/<name>/showcase/`, which survives the split, so the card
    // is complete before a single archive byte is downloaded.
    const onDiskSet = new Set(onDiskModes);
    const catalog: RegistryCatalogEntry[] = catalogListings
      .filter((entry) => !onDiskSet.has(entry.name))
      .map((entry) => {
        let showcase: RegistryShowcase | undefined;
        try {
          const showcasePath = join(modesRoot, entry.name, "showcase", "showcase.json");
          if (existsSync(showcasePath)) {
            showcase = localizeShowcase(JSON.parse(readFileSync(showcasePath, "utf-8")), locale);
          }
        } catch { /* a mode with no showcase in the package still gets a card */ }
        const description = pickLocalized(entry.description, locale);
        // Where the mode's source actually is, asked of the module that owns
        // the answer rather than reconstructed from the install layout here.
        // Null while nothing is installed, which is what keeps the field's
        // presence a usable "there is source to copy" signal.
        const resolved =
          entry.state === "installed"
            ? resolveCatalogMode(entry.name, { projectRoot })
            : null;
        return {
          name: entry.name,
          displayName: pickLocalized(entry.displayName, locale) || entry.name,
          ...(description ? { description } : {}),
          ...(entry.icon ? { icon: entry.icon } : {}),
          version: entry.version,
          unpackedSize: entry.unpackedSize,
          downloadSize: entry.archive?.size ?? 0,
          state: entry.state,
          ...(resolved ? { installPath: resolved.modeDir } : {}),
          ...(showcase ? { showcase } : {}),
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
            const parsed = parseManifestTs(content, locale);
            // Hidden flag honored for installed external modes too. Lets
            // a third-party mode declare itself "internal" (e.g. an
            // onboarding-style helper triggered by another mode) without
            // showing up in the launcher's Local Modes grid.
            if (parsed.hidden === true) continue;
            const compat = checkCompat(parsed.pneumaVersion ?? null, runtimeVersion);
            local.push({
              name: parsed.name || entry,
              displayName: parsed.displayName || entry,
              description: parsed.description,
              icon: parsed.icon,
              version: parsed.version || "local",
              path: entryPath,
              ...(parsed.pneumaVersion ? { pneumaVersion: parsed.pneumaVersion } : {}),
              ...(compat.level !== "unknown" ? { compat } : {}),
            });
          } catch { }
        }
      }
    } catch { }

    // Library-installed modes — append activated entries with a
    // `librarySource` tag so the launcher can group them and offer
    // per-library "Check updates" without a separate API call. The path
    // is the absolute on-disk mode dir, identical to the single-mode
    // path, so existing launch logic (`Launcher.tsx` POSTs `specifier:
    // mode.path` to `/api/launch`) keeps working untouched.
    try {
      const { listLibraries, getLibraryModePath } = await import("../core/library-registry.js");
      for (const lib of listLibraries()) {
        for (const m of lib.modes) {
          if (!m.activated) continue;
          const abs = getLibraryModePath(lib.id, m.name);
          if (!abs) continue; // skip stale sidecar entries
          let parsed: ReturnType<typeof parseManifestTs> = {};
          try {
            const manifestPath = ["manifest.ts", "manifest.js"]
              .map((f) => join(abs, f))
              .find((p) => existsSync(p));
            if (manifestPath) parsed = parseManifestTs(readFileSync(manifestPath, "utf-8"), locale);
          } catch { /* tolerate parse failures, fall back to sidecar fields */ }
          if (parsed.hidden === true) continue;
          // Per-mode pneumaVersion takes precedence; fall back to the
          // library-level declaration so a single library-wide stamp can
          // cover every mode that doesn't override.
          const declaredCompat = parsed.pneumaVersion ?? m.pneumaVersion ?? lib.pneumaVersion ?? null;
          const compat = checkCompat(declaredCompat, runtimeVersion);
          local.push({
            name: parsed.name || m.name,
            displayName: parsed.displayName || m.name,
            description: parsed.description,
            icon: parsed.icon,
            version: parsed.version || m.manifestVersion,
            path: abs,
            librarySource: {
              id: lib.id,
              name: lib.name,
              ...(lib.displayName ? { displayName: lib.displayName } : {}),
            },
            ...(m.installedVersion && m.installedVersion !== m.manifestVersion
              ? { updateAvailable: true }
              : {}),
            ...(declaredCompat ? { pneumaVersion: declaredCompat } : {}),
            ...(compat.level !== "unknown" ? { compat } : {}),
          });
        }
      }
    } catch { /* library subsystem failure should not break the registry */ }

    return { runtimeVersion, builtins, catalog, published, local };
  };

  /**
   * SWR registry getter, scoped per locale. If cache fresh (< TTL) → return
   * immediately. If stale → return stale + revalidate in background. If
   * empty → block until first fetch (one-time cost). Concurrent callers
   * for the same locale dedupe via the in-flight Promise map.
   */
  const getRegistry = async (locale: string): Promise<RegistryResponse> => {
    const now = Date.now();
    const cached = registryCache.get(locale);
    if (cached && now - cached.fetchedAt < REGISTRY_TTL_MS) {
      return cached.value;
    }
    if (cached) {
      if (!registryInflight.has(locale)) {
        registryInflight.set(
          locale,
          buildRegistry(locale)
            .then((value) => {
              registryCache.set(locale, { value, fetchedAt: Date.now() });
              registryInflight.delete(locale);
              return value;
            })
            .catch((err) => {
              console.warn(`[registry-cache] revalidate failed (${locale}): ${err}`);
              registryInflight.delete(locale);
              return cached.value;
            }),
        );
      }
      return cached.value;
    }
    if (!registryInflight.has(locale)) {
      registryInflight.set(
        locale,
        buildRegistry(locale)
          .then((value) => {
            registryCache.set(locale, { value, fetchedAt: Date.now() });
            registryInflight.delete(locale);
            return value;
          })
          .catch((err) => {
            registryInflight.delete(locale);
            throw err;
          }),
      );
    }
    return registryInflight.get(locale)!;
  };

  // Resolver: pick the request's locale from query string or fall back to user setting.
  const resolveRequestLocale = async (queryLocale: string | undefined): Promise<string> => {
    const { normalizeLocale, getUserLocale, detectSystemLocale } = await import("../core/locale.js");
    return normalizeLocale(queryLocale) || getUserLocale() || detectSystemLocale();
  };

  // Prime English in the background so the first /api/registry call is instant.
  void getRegistry("en").catch(() => { /* already logged */ });

  const mountRegistryRoute = (target: Hono) => {
    target.get("/api/registry", async (c) => {
      const locale = await resolveRequestLocale(c.req.query("locale"));
      const data = await getRegistry(locale);
      return c.json(data);
    });
  };

  // `/api/catalog` + `/api/catalog/install` go wherever `/api/registry` goes,
  // and for the same reason: the registry is what tells a surface that a mode
  // needs downloading, so every surface that reads it can offer the download.
  // The ProjectPanel's mode picker runs inside a PER-SESSION server and posts
  // to its own origin — mounted on the launcher alone, its "Start in any mode"
  // download hit a route that was not there and could never finish.
  //
  // Installing into `~/.pneuma/catalog/` is a machine-level operation either
  // way: nothing about it depends on which server flavour is asked, and the
  // installer is idempotent, so a second server offering it is not a second
  // copy of anything.
  const mountCatalogRoutes = (target: Hono) => {
    registerCatalogRoutes(target, {
      projectRoot: options.projectRoot || resolve(dirname(import.meta.path), ".."),
      // A finished install changes what the registry can launch, so drop the
      // SWR cache on the same tick instead of waiting out its TTL.
      onInstalled: () => registryCache.clear(),
    });
  };

  // User locale (UI language). Persisted in ~/.pneuma/settings.json under
  // top-level "locale". Mounted on every server flavour (launcher + per-
  // session) because the frontend `syncLocaleFromServer` fires on every
  // page load regardless of which port served it; a 404 here silently
  // falls the user back to browser-detected locale.
  const mountUserLocaleRoutes = (target: Hono) => {
    target.get("/api/user-locale", async (c) => {
      const { getUserLocale, detectSystemLocale } = await import("../core/locale.js");
      return c.json({ locale: getUserLocale(), systemLocale: detectSystemLocale() });
    });
    target.post("/api/user-locale", async (c) => {
      const body = await c.req.json<{ locale?: string | null }>();
      const { setUserLocale, normalizeLocale } = await import("../core/locale.js");
      const normalized = body.locale === null ? null : normalizeLocale(body.locale);
      if (body.locale && !normalized) {
        return c.json({ error: `Unsupported locale: ${body.locale}` }, 400);
      }
      setUserLocale(normalized);
      // Invalidate registry cache so the next /api/registry call rebuilds
      // localized strings for the new locale instead of serving stale data.
      registryCache.clear();
      return c.json({ ok: true, locale: normalized });
    });

    // User theme. Mirrors the locale routes — value is one of "system" |
    // "light" | "dark". Persisted at the top level of settings.json so
    // session viewers can read it for default content set selection
    // (e.g. slide's en-dark / zh-light seed picker).
    target.get("/api/user-theme", async (c) => {
      const { getUserTheme } = await import("../core/user-theme.js");
      return c.json({ theme: getUserTheme() });
    });
    target.post("/api/user-theme", async (c) => {
      const body = await c.req.json<{ theme?: string | null }>();
      const { setUserTheme, normalizeTheme } = await import("../core/user-theme.js");
      const normalized = body.theme === null ? null : normalizeTheme(body.theme);
      if (body.theme && !normalized) {
        return c.json({ error: `Unsupported theme: ${body.theme}` }, 400);
      }
      setUserTheme(normalized);
      return c.json({ ok: true, theme: normalized });
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
    mountCatalogRoutes(app);

    app.get("/api/backends", async (c) => {
      const descriptors = getBackendDescriptors();
      const availability = detectBackendAvailability();
      const { getBackendPrefs } = await import("../core/backend-prefs.js");
      const prefs = getBackendPrefs();
      const backends = descriptors.map((desc) => {
        const avail = availability.find((a) => a.type === desc.type);
        return {
          ...desc,
          available: avail?.available ?? false,
          reason: avail?.reason,
          // Per-user disable flag. Persistent; defaults to enabled (false).
          // Session-creation pickers should treat `disabled: true` as "hide";
          // the launcher Settings panel still surfaces it so the user can
          // re-enable.
          disabled: prefs[desc.type]?.disabled === true,
        };
      });
      return c.json({ backends, defaultBackendType: getDefaultBackendType() });
    });

    // Toggle the per-user disable flag for a backend. Used by the launcher
    // Settings panel — see `BackendsSection` in `Launcher.tsx`. Disabling
    // a backend doesn't kill running sessions, only hides it from future
    // session-creation pickers.
    app.post("/api/backends/:type/disabled", async (c) => {
      const type = c.req.param("type");
      const body = await c.req.json<{ disabled?: boolean }>().catch(() => ({} as { disabled?: boolean }));
      if (typeof body.disabled !== "boolean") {
        return c.json({ error: "disabled must be a boolean" }, 400);
      }
      // Sanity-check the backend type against the registry so a typo can't
      // pollute settings.json with bogus keys that nothing else reads.
      const known = getBackendDescriptors().some((d) => d.type === type);
      if (!known) {
        return c.json({ error: `unknown backend type "${type}"` }, 400);
      }
      const { setBackendDisabled } = await import("../core/backend-prefs.js");
      const next = setBackendDisabled(type, body.disabled);
      return c.json({ ok: true, disabled: next[type]?.disabled === true, prefs: next });
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
            const installLocale = await resolveRequestLocale(c.req.query("locale"));
            const parsed = parseManifestTs(content, installLocale);
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
      if (!name || !assetPath || name === "." || name === ".." || name.includes("\\")) {
        return c.json({ error: "Invalid path" }, 400);
      }
      const projectRoot = options.projectRoot || resolve(dirname(import.meta.path), "..");
      // Check builtin modes first, then local modes
      const builtinShowcase = resolve(join(projectRoot, "modes", name, "showcase"));
      const localShowcase = resolve(join(homedir(), ".pneuma", "modes", name, "showcase"));
      let fullPath = resolve(join(builtinShowcase, assetPath));
      // Path containment: resolved path must stay inside one of the showcase
      // dirs, also once symlinks are resolved.
      if (fullPath === builtinShowcase || !isContained(fullPath, builtinShowcase)) {
        return c.json({ error: "Invalid path" }, 400);
      }
      if (!existsSync(fullPath)) {
        const localFull = resolve(join(localShowcase, assetPath));
        if (localFull !== localShowcase && isContained(localFull, localShowcase) && existsSync(localFull)) {
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
      // Extra safety: the thumbnail (or a `.pneuma` link) must not lead
      // outside the registered workspace.
      if (!isContained(thumbPath, resolvedWorkspace)) {
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
      // `workspace` is optional and only used to discover launch-time options:
      // a workspace that is itself a Pneuma project supplies the project root
      // that `optionsSource: { roots: ["project-root"] }` scans.
      const { specifier, workspace: rawWorkspace } = await c.req.json<{
        specifier: string;
        workspace?: string;
      }>();
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

        const { prepareInitParams } = await import("./init-params.js");
        const params = prepareInitParams(manifest.init?.params, {
          projectRoot: await pneumaProjectRootFor(rawWorkspace),
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

    // List running child processes (the children *this* launcher spawned).
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

    // List ALL running `pneuma <mode>` sessions, system-wide — read from the
    // shared running-session registry (`~/.pneuma/running/`), not just this
    // launcher's own children. Each entry carries that process's *current*
    // mode, so a session that switched modes internally (handoff / onboard
    // task-card) is reflected accurately. Shape mirrors `/api/processes/children`
    // (`specifier` = the mode) so the launcher consumes it uniformly, plus a
    // `thumbnailUrl` when one exists (project sessions in particular — the
    // launcher otherwise only knows how to find quick-session thumbnails).
    app.get("/api/running", (c) => {
      const processes = readRunning().map((r) => {
        let thumbnailUrl: string | undefined;
        try {
          if (r.kind === "project" && r.projectRoot && r.sessionId) {
            if (existsSync(join(r.sessionDir, "thumbnail.png"))) {
              thumbnailUrl = `/api/projects/${encodeURIComponent(r.projectRoot)}/sessions/${encodeURIComponent(r.sessionId)}/thumbnail`;
            }
          } else if (existsSync(join(r.workspace, ".pneuma", "thumbnail.png"))) {
            thumbnailUrl = `/api/sessions/thumbnail?workspace=${encodeURIComponent(r.workspace)}`;
          }
        } catch { /* ignore */ }
        return {
          pid: r.pid,
          specifier: r.mode,
          workspace: r.workspace,
          url: r.url,
          startedAt: r.startedAt,
          ...(thumbnailUrl ? { thumbnailUrl } : {}),
        };
      });
      return c.json({ processes });
    });

    // Kill a running session by pid — our own child or any known running
    // session (e.g. a handoff target spawned by a different server). SIGTERM
    // first; then, after a short grace, SIGKILL if it's still alive. The
    // graceful path runs the session's own shutdown (final history save,
    // registry de-register); the force path covers wedged processes (a
    // hung shutdown, or a signal handler that just doesn't fire) so a stuck
    // session can never become an un-closable "running" card. The dead-PID
    // prune on the next `/api/running` read clears the registry entry; we
    // also drop it here for a snappy refresh.
    app.post("/api/processes/children/:pid/kill", (c) => {
      const pid = parseInt(c.req.param("pid"), 10);
      if (!Number.isInteger(pid) || pid <= 0) return c.json({ error: "Bad pid" }, 400);
      const own = childProcesses.get(pid);
      const runningEntry = readRunning().find((r) => r.pid === pid);
      if (!own && !runningEntry) return c.json({ error: "Process not found" }, 404);

      try { (own ? own.proc.kill() : process.kill(pid, "SIGTERM")); } catch { /* already gone */ }
      if (own) childProcesses.delete(pid);

      setTimeout(() => {
        try {
          process.kill(pid, 0);          // throws if it already exited
          process.kill(pid, "SIGKILL");
        } catch { /* exited gracefully — good */ }
        if (runningEntry) { try { removeRunning(runningEntry.id); } catch { /* ignore */ } }
      }, 1500);

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
          const { saveCfPagesConfig, parseCustomDomains } = await import("./cloudflare-pages.js");
          saveCfPagesConfig({
            apiToken: (body.config.token as string) ?? "",
            accountId: (body.config.accountId as string) ?? "",
            customDomains: parseCustomDomains((body.config.customDomains as string) ?? ""),
          });
        }
      }
      return c.json({ ok: true });
    });

    mountUserLocaleRoutes(app);

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
            if (isGitObjectId(headHash)) {
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
    // `launchSession` lets `/api/projects/onboard/apply` spawn the chosen
    // task's target mode in one round-trip — same pattern as handoff
    // confirm. The launcher mounts this so an EmptyShell auto-trigger
    // landing on the launcher port can still complete a project-onboard
    // → target-mode hop without bouncing off `/api/launch`.
    mountProjectsRoutes(app, {
      homeDir: homedir(),
      launchSession: async (params) => {
        const result = await launchPneumaChild({
          specifier: params.mode,
          workspace: params.project,
          project: params.project,
          sessionId: params.sessionId,
          fromSessionId: params.fromSessionId,
          fromMode: params.fromMode,
          fromDisplayName: params.fromDisplayName,
        });
        return result.url;
      },
    });

    // Prime the per-project cache for every known project so the launcher's
    // "Recent Projects" grid renders from cache on first paint. The first
    // /api/projects call that arrives before priming finishes still works
    // (it falls back to a synchronous SWR scan); priming just lets the
    // common case skip that one-time cost. Wrapped so a malformed registry
    // doesn't block server start.
    primeRegisteredProjects(join(homedir(), ".pneuma", "sessions.json"));

    // ── Handoff routes (v2 tool-call protocol) ─────────────────────────
    // Mount `/api/libraries/*` + `/api/github/status` — launcher-scope only
    // (libraries are a launcher-wide concern; per-session servers don't
    // register these). Broadcasts `libraries_updated` on every mutation.
    // Agent command + external-handoff + CLI helpers — launcher-scope.
    // Mounted before library routes (no dependency) so the launcher
    // first-run banner can show on the same tick as the rest of the UI.
    {
      const pkgPath = join(resolve(dirname(import.meta.path), ".."), "package.json");
      const projectRoot = options.projectRoot || resolve(dirname(import.meta.path), "..");
      let pneumaVersion = "0.0.0";
      try {
        pneumaVersion = JSON.parse(readFileSync(pkgPath, "utf-8")).version ?? "0.0.0";
      } catch {
        // dev tree with no package.json: keep the placeholder; status route still works
      }
      registerAgentCommandRoutes(app, { pneumaVersion, projectRoot });
      // Silent: re-stamp installed slash commands to match the running
      // pneuma version. Soft-fails — never blocks launcher boot.
      bootstrapAgentCommandAutoUpdate({ pneumaVersion, projectRoot });
    }

    registerLibraryRoutes(app, wsBridge, {
      projectRoot:
        options.projectRoot || resolve(dirname(import.meta.path), ".."),
      // Library mutations change which modes surface in `/api/registry`
      // `local[]` (every activated library mode lands there). Dropping the
      // SWR cache here lets the launcher Quick Start grid see new library
      // modes on the same tick as the WS `libraries_updated` broadcast,
      // instead of waiting for the 60s TTL to elapse.
      invalidateRegistry: () => {
        registryCache.clear();
      },
    });

    // ── Favorites (launcher-scope) ─────────────────────────────────────
    // Persistent user-pinned modes. The launcher reads this list to
    // order Quick Start tiles and to mark favorited tiles with a small
    // badge. The project mode-tile picker reads the same list. Sourced
    // from `~/.pneuma/favorites.json` so it survives browser reset and
    // is shared across all launcher sessions on this machine.
    app.get("/api/favorites", async (c) => {
      try {
        const { readFavorites, DEFAULT_FAVORITES } = await import("../core/favorites.js");
        return c.json({ favorites: readFavorites(), defaults: [...DEFAULT_FAVORITES] });
      } catch (err) {
        return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
      }
    });
    app.post("/api/favorites", async (c) => {
      try {
        const body = await c.req.json<{ favorites?: unknown }>();
        if (!Array.isArray(body.favorites)) {
          return c.json({ error: "favorites must be an array of mode names" }, 400);
        }
        const { writeFavorites, readFavorites } = await import("../core/favorites.js");
        writeFavorites(body.favorites as string[]);
        return c.json({ favorites: readFavorites() });
      } catch (err) {
        return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
      }
    });

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
          workspace: params.workspace,
          project: params.project,
          sessionId: params.sessionId,
          backendType: params.backendType as AgentBackendType | undefined,
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
            (s) =>
              (s.kind === "project" && s.sessionId === sourceSessionId) ||
              (s.kind === "quick" && s.id === sourceSessionId),
          );
          if (!entry) return null;
          if (entry.kind === "quick") {
            // Mirrors the per-session arm: a quick source hands its workspace
            // to a new quick session, and gets no project for it.
            return {
              kind: "quick" as const,
              workspace: entry.workspace,
              ...(entry.backendType ? { backendType: entry.backendType } : {}),
              mode: entry.mode,
              displayName: entry.sessionName || entry.displayName,
            };
          }
          return {
            kind: "project" as const,
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
    let server: ReturnType<typeof Bun.serve>;
    let serverPort: number;
    try {
      ({ server, port: serverPort } = await bindFirstFreePort(port, MAX_PORT_ATTEMPTS, (candidate) =>
        Bun.serve({ port: candidate, hostname: "0.0.0.0", fetch: app.fetch }),
      ));
    } catch (err) {
      // Nothing is listening: release the project-cache watchers primed above.
      await shutdownProjectCache().catch(() => {});
      throw err;
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

  // Hot-reload proxy.json from the session's workspace watcher — the same
  // single watch on the workspace root that feeds content updates.
  const unsubscribeProxy = options.workspaceWatcher
    ? startProxyWatcher(options.workspaceWatcher, (config) => {
        proxyConfigRef.current = mergeProxyConfig(
          options.manifestProxy,
          config as Record<string, ProxyRoute> | undefined,
        );
        console.log(`[proxy] Config reloaded: ${proxyConfigRef.current.size} route(s)`);
      })
    : undefined;

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
  /**
   * The session this server serves. Prefers the live agent connection (a
   * quick session learns its id only when the agent connects), else the id
   * from `session.json` at boot, which `bin` updates once it knows it — so a
   * `--viewing` session, which never connects an agent, still has one.
   */
  const currentSessionId = (): string | null => wsBridge.getActiveSessionId() ?? (sessionInfo.sessionId || null);

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
      sessionId: currentSessionId(),
      project: projectInfo,
      // Per-session working directory — the agent's CWD. Equals the project
      // session dir for project sessions and the quick-session workspace for
      // quick sessions. The Editor tabbar's "open in IDE" button targets
      // this path so the IDE always lands on the agent's actual working
      // surface, not the shared project root (which the ProjectPanel's own
      // open-IDE button already covers separately).
      workspace,
      // Workspace watcher health (`core/types/workspace-watcher.ts`): which
      // backend delivers file changes, whether it is ready, whether it fell
      // back or reported an error, and when it last heard a change.
      watcher: options.workspaceWatcher?.health() ?? null,
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

  // Save an agent-requested viewer capture (the `capture` viewer action).
  // The viewer renders itself to a PNG and POSTs the base64 here; we persist
  // it under the session's captures/ dir and hand back an absolute path the
  // agent can Read. This keeps visual self-QA inside Pneuma instead of the
  // agent spawning an external browser.
  app.post("/api/session/capture", async (c) => {
    try {
      const body = await c.req.json();
      const { data } = body; // base64 PNG data
      if (!data) return c.json({ ok: false, message: "Missing data" }, 400);
      const capturesDir = join(stateDirForSession, "captures");
      if (!existsSync(capturesDir)) mkdirSync(capturesDir, { recursive: true });
      // Prune — keep only the most recent captures so the dir can't grow
      // unbounded across a long session.
      try {
        const existing = readdirSync(capturesDir)
          .filter((f) => f.startsWith("capture-") && f.endsWith(".png"))
          .sort();
        for (const stale of existing.slice(0, Math.max(0, existing.length - 19))) {
          try { unlinkSync(join(capturesDir, stale)); } catch { /* best effort */ }
        }
      } catch { /* best effort */ }
      const capturePath = join(capturesDir, `capture-${Date.now()}.png`);
      writeFileSync(capturePath, Buffer.from(data, "base64"));
      return c.json({ ok: true, path: capturePath });
    } catch (err) {
      return c.json({ ok: false, message: "Failed to save capture" }, 500);
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

  // ── Session-meta refine (agent-driven via `pneuma session refine` CLI) ─
  //
  // The agent calls `pneuma session refine --json '{...}'` when the
  // conversation has produced enough substance for a meaningful title /
  // one-line summary, or when the user explicitly asks for a re-titling.
  // The CLI POSTs here; we atomically rewrite `<sessionDir>/session.json`,
  // sync the registry entry so the launcher's next list-fetch reflects the
  // change, and broadcast `session_meta_updated` so any open browsers
  // refresh their row in place.
  //
  // Capacity caps are mirrored client-side in `bin/session-cli.ts`; the
  // server is the source of truth so any future CLI clones can't bypass them.
  app.post("/api/session/refine", async (c) => {
    const DISPLAY_NAME_MAX = 40;
    const DESCRIPTION_MAX = 280;

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

    const coerce = (key: string, maxLen: number): string | undefined => {
      const value = body[key];
      if (value === undefined || value === null) return undefined;
      if (typeof value !== "string") {
        throw new Error(`field "${key}" must be a string`);
      }
      const trimmed = value.trim();
      if (trimmed.length === 0) return undefined;
      if (trimmed.length > maxLen) {
        throw new Error(`field "${key}" must be ≤${maxLen} characters (got ${trimmed.length})`);
      }
      return trimmed;
    };

    let displayName: string | undefined;
    let description: string | undefined;
    try {
      displayName = coerce("displayName", DISPLAY_NAME_MAX);
      description = coerce("description", DESCRIPTION_MAX);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
    if (displayName === undefined && description === undefined) {
      return c.json(
        { error: 'payload must include at least one of "displayName" or "description"' },
        400,
      );
    }

    // `targetSessionId` makes this refine land on a *sibling* session under
    // the same project root instead of the server's own session — the
    // `project-tidy` mode uses it to re-title every un-tidied session in one
    // pass. Absent, behaviour is unchanged (refine the active session).
    const targetSessionId =
      typeof body.targetSessionId === "string" ? body.targetSessionId.trim() : "";
    let resolvedStateDir = stateDirForSession;
    let resolvedRegistryId = options.pneumaProjectRoot
      ? `${options.pneumaProjectRoot}::${options.sessionId ?? ""}`
      : `${workspace}::${options.modeName ?? ""}`;
    if (targetSessionId) {
      if (!options.pneumaProjectRoot) {
        return c.json({ error: "targetSessionId requires a project session" }, 400);
      }
      // Guard against path traversal — the id is a directory name.
      if (!/^[A-Za-z0-9_-]+$/.test(targetSessionId)) {
        return c.json({ error: "invalid targetSessionId" }, 400);
      }
      const siblingDir = join(
        options.pneumaProjectRoot,
        ".pneuma",
        "sessions",
        targetSessionId,
      );
      if (!existsSync(join(siblingDir, "session.json"))) {
        return c.json({ error: `session ${targetSessionId} not found` }, 404);
      }
      resolvedStateDir = siblingDir;
      resolvedRegistryId = `${options.pneumaProjectRoot}::${targetSessionId}`;
    }

    const refinedAt = Date.now();
    const sessionPath = join(resolvedStateDir, "session.json");

    // 1. Patch session.json (canonical source). Merge into the existing file
    //    so we don't clobber sessionId / agentSessionId / backendType / etc.
    let persisted: Record<string, unknown> = {};
    try {
      if (existsSync(sessionPath)) {
        persisted = JSON.parse(readFileSync(sessionPath, "utf-8"));
      }
    } catch (err) {
      console.warn("[server] /api/session/refine: failed to read session.json:", err);
    }
    if (displayName !== undefined) persisted.displayName = displayName;
    if (description !== undefined) persisted.description = description;
    persisted.refinedAt = refinedAt;
    try {
      writeFileSync(sessionPath, JSON.stringify(persisted, null, 2));
    } catch (err) {
      console.error("[server] /api/session/refine: failed to write session.json:", err);
      return c.json({ error: "failed to persist session meta" }, 500);
    }

    // 2. Sync the global registry entry so the launcher's next list-fetch
    //    sees the refined fields without round-tripping through session.json.
    //    The id format mirrors `recordSession()` in bin/pneuma.ts.
    try {
      const candidateId = resolvedRegistryId;
      const registryPath = join(homedir(), ".pneuma", "sessions.json");
      const data = readSessionsFileSync(registryPath);
      const idx = data.sessions.findIndex((s) => s.id === candidateId);
      if (idx >= 0) {
        const existing = data.sessions[idx];
        const merged: AnySessionRegistryEntry = { ...existing };
        // Refined displayName only overrides the resolved name when the user
        // hasn't manually set a `sessionName` — explicit user intent wins.
        if (displayName !== undefined && !existing.sessionName) {
          merged.displayName = displayName;
        }
        if (description !== undefined) merged.description = description;
        else if (description === undefined && existing.description) merged.description = existing.description;
        merged.refinedAt = refinedAt;
        const next: SessionsFile = {
          projects: data.projects,
          sessions: [...data.sessions.slice(0, idx), merged, ...data.sessions.slice(idx + 1)],
        };
        writeSessionsFileSync(registryPath, next);
      }
      // Miss is non-fatal — the entry will get refreshed on next session
      // start via recordSession(), and ProjectPanel reads from session.json
      // directly (via scanProjectSessions) so project rows already see the
      // update.
    } catch (err) {
      console.warn("[server] /api/session/refine: registry sync failed:", err);
    }

    // 3. Broadcast to any attached browsers so the chip / row updates in
    //    place. ProjectPanel + Launcher Recent Sessions listen for this.
    const activeId = wsBridge.getActiveSessionId();
    if (activeId) {
      try {
        wsBridge.broadcastToSession(activeId, {
          type: "session_meta_updated",
          session_id: targetSessionId || activeId,
          ...(displayName !== undefined ? { displayName } : {}),
          ...(description !== undefined ? { description } : {}),
          refinedAt,
        });
      } catch (err) {
        // Broadcast failures are non-fatal — the persistence above is the
        // source of truth and the next reload will pick it up.
        console.warn("[server] /api/session/refine: broadcast failed:", err);
      }
    }

    return c.json({
      ok: true,
      ...(displayName !== undefined ? { displayName } : {}),
      ...(description !== undefined ? { description } : {}),
      refinedAt,
    });
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
  // The ProjectPanel lives in this server too, and its mode picker downloads a
  // catalog mode before it opens the launch sheet.
  mountCatalogRoutes(app);
  mountUserLocaleRoutes(app);

  // ── Project routes API ──────────────────────────────────────────────
  // Per-session server gets the same `launchSession` wiring as the
  // launcher, so a project-onboard session inside this server can apply
  // its discovery report and spawn the chosen task in-process.
  mountProjectsRoutes(app, {
    homeDir: homedir(),
    launchSession: async (params) => {
      const result = await launchPneumaChild({
        specifier: params.mode,
        workspace: params.project,
        project: params.project,
        sessionId: params.sessionId,
        fromSessionId: params.fromSessionId,
        fromMode: params.fromMode,
        fromDisplayName: params.fromDisplayName,
      });
      return result.url;
    },
  });

  // The per-project cache is primed by the caller BEFORE it creates the
  // workspace watcher (`primeRegisteredProjects`, see bin/pneuma.ts): every
  // prime registers a watch, and on macOS each registration can drop the
  // workspace watch's events.

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
        workspace: params.workspace,
        project: params.project,
        sessionId: params.sessionId,
        backendType: params.backendType as AgentBackendType | undefined,
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
      if (sourceSessionId === activeId && options.modeName) {
        if (options.pneumaProjectRoot) {
          const manifest = await loadProjectManifest(options.pneumaProjectRoot).catch(() => null);
          return {
            kind: "project" as const,
            projectRoot: options.pneumaProjectRoot,
            mode: options.modeName,
            displayName: manifest?.displayName ?? undefined,
          };
        }
        // A quick session. It has no project and gets none: the handoff hands
        // this workspace to a new quick session, which is unrelated to this
        // one beyond a `sourceSessionId` mark in its `session.json`. Sessions
        // that need to be related are what a project is for.
        return {
          kind: "quick" as const,
          workspace: options.workspace,
          ...(sessionInfo.backendType ? { backendType: sessionInfo.backendType } : {}),
          mode: options.modeName,
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
          kind: "project" as const,
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

  // ── Borrow routes (peer / round-trip cross-mode handoff) ────────────
  // Mounted on the per-session server — A's OWN server, not the launcher.
  // The launcher has no agent session, so its WS broadcast can't poke A's
  // live agent (server.md gotcha); A's own server is the only thing that can
  // enqueue the return tag to A. A borrow NEVER kills A's session — B runs in
  // a background sub-session and relays a result; control stays with A.
  const borrowRoutesContext = mountBorrowRoutes(app, {
    wsBridge,
    // Resolved at request time (see `currentSessionId`).
    hostSessionId: () => currentSessionId() ?? "",
    // The brief's `return_via.host_server_url` is filled at dispatch time, so
    // it reflects the final bound port (which auto-increments on collision).
    hostServerUrl: () => `http://localhost:${serverPort}`,
    // Validate B's mode against the local-mode enumerator — never branch on
    // the mode name (hard rule). Mirrors handoff-from-external's validation.
    validateMode: (mode) => {
      try {
        const enumProjectRoot =
          options.projectRoot || resolve(dirname(import.meta.path), "..");
        return enumerateLocalModes({ projectRoot: enumProjectRoot }).some(
          (m) => m.name === mode,
        );
      } catch (err) {
        console.warn(`[borrow-routes] validateMode failed for ${mode}: ${err}`);
        return false;
      }
    },
    // Placement: a project session (this server has a pneumaProjectRoot) puts
    // B under the project; a quick session resolves to no root → temp dir.
    resolveHost: async () => ({
      ...(options.pneumaProjectRoot ? { projectRoot: options.pneumaProjectRoot } : {}),
    }),
    // Spawn B in the background, reusing the single `launchPneumaChild` seam.
    // For a quick borrow (no project) B runs in its OS temp dir as workspace.
    launchBorrow: async (params) => {
      const result = await launchPneumaChild({
        specifier: params.mode,
        workspace: params.project ?? join(tmpdir(), `pneuma-borrow-${params.sessionId}`),
        ...(params.project ? { project: params.project } : {}),
        sessionId: params.sessionId,
        // The borrow_id IS B's session id — thread it as `--borrow` too so B
        // stamps its session.json provenance + dispatches `reason="borrow"`.
        borrowId: params.sessionId,
        background: params.background,
      });
      return { sessionId: params.sessionId, url: result.url };
    },
  });

  // /api/launch/prepare in the per-session server — lets ProjectPanel's
  // launch sheet pre-fetch a mode's init params (with auto-fill from stored
  // API keys) before the user confirms. Mirrors the launcher block above;
  // both branches share the same resolve → loadModeManifest → autoFill path.
  app.post("/api/launch/prepare", async (c) => {
    const { specifier, workspace: rawWorkspace } = await c.req.json<{
      specifier: string;
      workspace?: string;
    }>();
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

      // Auto-fill from stored API keys + resolve launch-time options — the
      // launcher route above shares this one implementation. The running
      // session already knows its own Pneuma project root; ProjectPanel's
      // `workspace` covers the empty-shell case, where there is no session yet.
      const { prepareInitParams } = await import("./init-params.js");
      const params = prepareInitParams(manifest.init?.params, {
        projectRoot:
          options.pneumaProjectRoot ?? (await pneumaProjectRootFor(rawWorkspace)),
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
    // Reaches `git archive <hash>`: anything but an object id (`--output=…`,
    // `--remote=… --exec=…`) would be parsed as an option.
    if (!isGitObjectId(hash)) return c.json({ error: "Invalid checkpoint hash" }, 400);
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
      // A replay package is untrusted input: a checkpoint can carry
      // symlinks. A linked file is read only when its canonical target stays
      // inside the checkout directory; linked directories are not descended
      // (their targets are walked on their own, and a link cycle cannot
      // recurse forever).
      function walk(dir: string, prefix: string) {
        for (const entry of readdirSync(dir)) {
          const full = join(dir, entry);
          const rel = prefix ? `${prefix}/${entry}` : entry;
          const isLink = lstatSync(full).isSymbolicLink();
          if (isLink && !isContained(full, outDir)) continue;
          let stat: ReturnType<typeof statSync>;
          try { stat = statSync(full); } catch { continue; } // dangling link
          if (stat.isDirectory()) {
            if (!isLink) walk(full, rel);
          } else if (stat.size < 500_000) {
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

  // ── Seed Gallery (empty-state) ──────────────────────────────────────
  // GET /api/seeds/list — returns mode intro + seed cards for the gallery.
  // POST /api/seeds/apply — copies one seed entry into the workspace.
  // GET /api/mode/seed-gallery/* — serves thumbnail assets bundled with the mode.
  // POST /api/contentsets/delete — removes a content-set subdirectory.
  //
  // Mounted only when a mode is loaded (per-session, not launcher). The
  // launcher's mode-card showcase route is a separate path; gallery
  // thumbnails for a running mode resolve relative to the session's
  // `modeSourceDir` and do not need a `:name` URL parameter.
  if (options.modeManifest && options.modeSourceDir && options.seedBase) {
    const sessionManifest = options.modeManifest;
    const sessionModeSourceDir = options.modeSourceDir;
    const sessionSeedBase = options.seedBase;

    app.get("/api/seeds/list", async (c) => {
      const { getUserLocale } = await import("../core/locale.js");
      const locale = c.req.query("locale") ?? getUserLocale() ?? "en";
      const init = sessionManifest.init;
      const seeds = resolveSeedCatalog(init?.seedFiles, init?.seeds).map((seed) => ({
        id: seed.id,
        sourceKey: seed.sourceKey,
        displayName: resolveLocalized(seed.displayName, locale),
        description: seed.description ? resolveLocalized(seed.description, locale) : undefined,
        thumbnailUrl: seed.thumbnail ? `/api/mode/seed-gallery/${encodeURI(seed.thumbnail)}` : undefined,
        tags: seed.tags,
      }));
      return c.json({
        modeName: sessionManifest.name,
        modeIntro: {
          displayName: resolveLocalized(sessionManifest.displayName, locale),
          description: resolveLocalized(sessionManifest.description, locale),
          tagline: sessionManifest.showcase?.tagline
            ? resolveLocalized(sessionManifest.showcase.tagline, locale)
            : undefined,
          heroUrl: sessionManifest.showcase?.hero
            ? `/api/modes/${sessionManifest.name}/showcase/${encodeURI(sessionManifest.showcase.hero)}`
            : undefined,
          icon: sessionManifest.icon,
        },
        seeds,
      });
    });

    app.post("/api/seeds/apply", async (c) => {
      try {
        const body = await c.req.json<{ sourceKey?: string | string[] }>();
        const sourceKeys = Array.isArray(body.sourceKey)
          ? body.sourceKey
          : body.sourceKey
            ? [body.sourceKey]
            : [];
        if (sourceKeys.length === 0) {
          return c.json({ ok: false, error: "sourceKey is required" }, 400);
        }
        const seedFiles = sessionManifest.init?.seedFiles;
        if (!seedFiles) {
          return c.json({ ok: false, error: "mode has no seedFiles" }, 400);
        }
        for (const k of sourceKeys) {
          if (!(k in seedFiles)) {
            return c.json({ ok: false, error: `unknown seed: ${k}` }, 404);
          }
          if (seedFiles[k].startsWith("_")) {
            return c.json({ ok: false, error: `framework-managed seed cannot be user-applied: ${k}` }, 400);
          }
        }

        const { getUserLocale } = await import("../core/locale.js");
        const locale = getUserLocale() ?? "en";
        // Plan every entry before writing any: a missing source or a copy
        // that would leave the workspace (a symlinked destination) refuses
        // the whole request with nothing written.
        const plans: SeedCopyPlan[] = [];
        for (const src of sourceKeys) {
          let plan: SeedCopyPlan | null;
          try {
            plan = planSeedEntry({
              workspace,
              seedBase: sessionSeedBase,
              src,
              dst: seedFiles[src],
              params: options.initParams ?? {},
              locale,
            });
          } catch (err) {
            if (err instanceof SeedContainmentError) {
              return c.json({ ok: false, error: err.message }, 403);
            }
            throw err;
          }
          if (!plan) {
            return c.json({ ok: false, error: `seed source not found on disk: ${src}` }, 404);
          }
          plans.push(plan);
        }
        const writtenFiles: string[] = [];
        let seededRootPackageJson = false;
        for (const plan of plans) {
          const result = applySeedPlan(plan);
          writtenFiles.push(...result.files);
          if (result.seededRootPackageJson) seededRootPackageJson = true;
        }

        // Tag the writes as self-originated so the watcher's echoes are
        // labelled "self" rather than "external". The 5s TTL is plenty
        // for file events to arrive after a single seed copy.
        for (const rel of writtenFiles) {
          try {
            const content = readFileSync(join(workspace, rel), "utf-8");
            registerSelfWrite(rel, content);
          } catch {
            // Binary files (matched by `isBinarySeedFile` in seed-installer)
            // are copied byte-for-byte; the watcher echo won't carry a
            // text payload to match anyway. Skip silently.
          }
        }

        if (seededRootPackageJson) {
          await runPostSeedInstall(workspace).catch((err) => {
            console.warn(`[seeds] post-install failed: ${err instanceof Error ? err.message : err}`);
          });
        }
        return c.json({ ok: true, files: writtenFiles, seededPackageJson: seededRootPackageJson });
      } catch (err) {
        const message = err instanceof Error ? err.message : "unknown error";
        return c.json({ ok: false, error: message }, 500);
      }
    });

    app.post("/api/contentsets/delete", async (c) => {
      try {
        const body = await c.req.json<{ prefix?: string }>();
        const prefix = body.prefix;
        if (!prefix) return c.json({ ok: false, error: "prefix is required" }, 400);
        // Guardrails: no traversal, no absolute, no leading dot/underscore
        // (the `_`-prefixed dirs are framework-managed seeds).
        if (
          prefix.includes("..") ||
          prefix.startsWith("/") ||
          prefix.startsWith(".") ||
          prefix.startsWith("_") ||
          prefix.includes("\0")
        ) {
          return c.json({ ok: false, error: `invalid prefix: ${prefix}` }, 400);
        }
        const target = resolve(join(workspace, prefix));
        // The whole target set is decided here, before anything is removed:
        // the prefix must be a directory strictly inside the workspace once
        // symlinks are resolved (a prefix through, or itself, a link to
        // outside is refused). `rmSync` below unlinks links nested inside
        // the content set rather than following them.
        if (target === resolve(workspace) || !isContained(target, workspace)) {
          return c.json({ ok: false, error: "prefix escapes workspace" }, 403);
        }
        if (!existsSync(target)) return c.json({ ok: false, error: "prefix does not exist" }, 404);
        if (!statSync(target).isDirectory()) {
          return c.json({ ok: false, error: "prefix is not a directory" }, 400);
        }

        // Register pending self-deletes for every file we're about to
        // unlink so the watcher's delete echoes are tagged "self".
        const glob = new Bun.Glob("**/*");
        const deleted: string[] = [];
        for (const rel of glob.scanSync({ cwd: target, absolute: false })) {
          const filePath = join(target, rel);
          try {
            if (statSync(filePath).isFile()) {
              const workspaceRel = join(prefix, rel);
              registerSelfDelete(workspaceRel);
              deleted.push(workspaceRel);
            }
          } catch {
            // Ignore individual stat failures; rmSync below cleans up.
          }
        }

        const { rmSync } = await import("node:fs");
        rmSync(target, { recursive: true, force: true });
        return c.json({ ok: true, deleted });
      } catch (err) {
        const message = err instanceof Error ? err.message : "unknown error";
        return c.json({ ok: false, error: message }, 500);
      }
    });

    // Serve showcase assets for the current mode. The launcher mounts an
    // equivalent route under `/api/modes/:name/showcase/*` for cross-mode
    // marketing; per-session sessions need only the current mode's
    // showcase (hero image, highlights) so the gallery's left-half intro
    // can render. Path containment is checked against the mode's
    // showcase dir.
    const showcaseRoot = resolve(join(sessionModeSourceDir, "showcase"));
    app.get(`/api/modes/${sessionManifest.name}/showcase/*`, async (c) => {
      const assetPath = c.req.path.split("/showcase/").slice(1).join("/showcase/");
      if (!assetPath) return c.json({ error: "Invalid path" }, 400);
      const fullPath = resolve(join(showcaseRoot, assetPath));
      if (fullPath === showcaseRoot || !isContained(fullPath, showcaseRoot)) {
        return c.json({ error: "Invalid path" }, 400);
      }
      if (!existsSync(fullPath)) return c.notFound();
      const ext = assetPath.split(".").pop()?.toLowerCase();
      const contentTypes: Record<string, string> = {
        png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
        webp: "image/webp", svg: "image/svg+xml", mp4: "video/mp4", webm: "video/webm",
      };
      const contentType = contentTypes[ext || ""] || "application/octet-stream";
      try {
        return new Response(Bun.file(fullPath), {
          headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=3600" },
        });
      } catch {
        return c.notFound();
      }
    });

    // Serve seed-gallery thumbnails bundled with the current mode. The
    // thumbnail path comes verbatim from the manifest's `seeds[].thumbnail`
    // field, resolved against `modeSourceDir`. Containment-checked.
    const seedGalleryRoot = resolve(join(sessionModeSourceDir, "seed-gallery"));
    app.get("/api/mode/seed-gallery/*", async (c) => {
      const assetPath = c.req.path.split("/seed-gallery/").slice(1).join("/seed-gallery/");
      if (!assetPath) return c.json({ error: "Invalid path" }, 400);
      const fullPath = resolve(join(seedGalleryRoot, assetPath));
      if (fullPath === seedGalleryRoot || !isContained(fullPath, seedGalleryRoot)) {
        return c.json({ error: "Invalid path" }, 400);
      }
      if (!existsSync(fullPath)) return c.notFound();
      const ext = assetPath.split(".").pop()?.toLowerCase();
      const contentTypes: Record<string, string> = {
        png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
        webp: "image/webp", svg: "image/svg+xml", mp4: "video/mp4", webm: "video/webm",
      };
      const contentType = contentTypes[ext || ""] || "application/octet-stream";
      try {
        return new Response(Bun.file(fullPath), {
          headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=3600" },
        });
      } catch {
        return c.notFound();
      }
    });
  }

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

  // Workspace-contained file server — chat inline image previews fetch a
  // file the agent read by its absolute path. Containment-checked.
  mountFileRoute(app, { workspace });

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
      if (contentSet && !isContained(scopedRoot, workspace)) {
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
        if (!isContained(abs, workspace)) {
          return c.json({ success: false, message: `Path escapes workspace: ${f.path}` }, 403);
        }
      }

      // Protected paths — never delete system files
      const PROTECTED = [".claude/", ".pneuma/", "CLAUDE.md", ".gitignore", ".mcp.json"];
      const isProtected = (relPath: string) =>
        PROTECTED.some((p) => p.endsWith("/") ? relPath.startsWith(p) : relPath === p);

      // 1. Delete files matching clear globs (scoped to contentSet if provided).
      // The complete deletion set is collected and checked before the first
      // unlink; a match whose canonical target is outside the workspace (a
      // link to outside) is never deleted.
      const toDelete = new Set<string>();
      if (Array.isArray(body.clear)) {
        for (const pattern of body.clear) {
          try {
            const matches = new Bun.Glob(pattern).scanSync({ cwd: scopedRoot, absolute: false });
            for (const matchPath of matches) {
              // matchPath is relative to scopedRoot; compute workspace-relative path
              const relPath = contentSet ? `${contentSet}/${matchPath}` : matchPath;
              if (isProtected(relPath)) continue;
              const absPath = join(workspace, relPath);
              if (isContained(absPath, workspace) && existsSync(absPath)) toDelete.add(absPath);
            }
          } catch {
            // skip invalid globs
          }
        }
      }
      let filesDeleted = 0;
      for (const absPath of toDelete) {
        unlinkSync(absPath);
        filesDeleted++;
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

  // ── Setup tab listing (clipcraft production-bible artifacts) ───────
  registerSetupListing(app, { workspace });

  // ── Save file ────────────────────────────────────────────────────────
  app.post("/api/files", async (c) => {
    const body = await c.req.json<{ path: string; content: string }>();
    const relPath = body.path;
    if (!relPath || typeof body.content !== "string") {
      return c.json({ error: "Missing path or content" }, 400);
    }
    const absPath = join(workspace, relPath);
    if (!isContained(absPath, workspace)) {
      return c.json({ error: "Forbidden" }, 403);
    }
    // `?origin=external` tells the server "this write is a user-initiated
    // edit, not a Source<T> autosave echo." When set, we skip the
    // registerSelfWrite call so the resulting watcher event is tagged
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
        // Register this write as self-originated so the watcher echo is
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
    if (!isContained(absPath, workspace)) {
      return c.json({ error: "Forbidden" }, 403);
    }
    try {
      // Register the self-delete BEFORE unlinking so the watcher's delete
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
    if (!isContained(absPath, workspace)) return c.json({ error: "Forbidden" }, 403);
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
      // `--relative`: a workspace nested inside a larger repository lists only
      // its own files, with workspace-relative paths (like `ls-files` below).
      const nameStatus = execSync("git -c core.quotePath=false diff HEAD --name-status --relative", { cwd: workspace, encoding: "utf-8", timeout: 10_000, stdio: ["pipe", "pipe", "pipe"] }).trim();
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
          // Argument vector, not a shell string: a ref name may contain `$(`.
          const branchStatus = execFileSync("git", ["-c", "core.quotePath=false", "diff", `${defaultBranch}...HEAD`, "--name-status", "--relative"], { cwd: workspace, encoding: "utf-8", timeout: 10_000, stdio: ["pipe", "pipe", "pipe"] }).trim();
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
    const absPath = join(workspace, filePath);
    // An untracked path is diffed with `--no-index`, which reads any file:
    // the path must be inside the workspace, also through symlinks.
    if (!isContained(absPath, workspace)) return c.json({ error: "Forbidden" }, 403);
    // Git receives the checked, normalized workspace-relative path — never
    // the raw request string — and `--literal-pathspecs` makes it a plain
    // path: otherwise `:(top)…`, `:/…` or a glob would select files git
    // resolves from the repository root, outside a nested workspace (`--`
    // ends options but does not disable pathspec magic).
    const relPath = relative(workspace, absPath).split(sep).join("/");
    if (!relPath) return c.json({ error: "path must name a file" }, 400);
    // Every git call takes an argument vector — request input never reaches
    // a shell.
    const git = (args: string[], timeout: number) =>
      execFileSync("git", ["--literal-pathspecs", "-c", "core.quotePath=false", ...args], { cwd: workspace, encoding: "utf-8", timeout, stdio: ["pipe", "pipe", "pipe"] }).trim();
    // `git diff` exits 1 when there are differences; its stdout is the diff.
    const gitDiff = (args: string[]) => {
      try { return git(args, 10_000); } catch (e: any) { return e.stdout?.toString().trim() || ""; }
    };
    try {
      let diff = "";
      // Check if file is untracked
      const tracked = git(["ls-files", "--", relPath], 5_000);
      if (!tracked) {
        // Untracked new file — diff against /dev/null (NUL on Windows). With
        // `--no-index` both operands are filesystem paths, not pathspecs.
        diff = gitDiff(["diff", "--no-index", "--", isWin ? "NUL" : "/dev/null", absPath]);
      } else if (base === "default-branch") {
        try {
          const defaultBranch = execFileSync("git", ["symbolic-ref", "refs/remotes/origin/HEAD", "--short"], { cwd: workspace, encoding: "utf-8", timeout: 5_000, stdio: ["pipe", "pipe", "pipe"] }).trim();
          diff = git(["diff", `${defaultBranch}...HEAD`, "--", relPath], 10_000);
        } catch { /* fallback to HEAD */ }
        if (!diff) diff = gitDiff(["diff", "HEAD", "--", relPath]);
      } else {
        diff = gitDiff(["diff", "HEAD", "--", relPath]);
      }
      return c.json({ path: filePath, diff });
    } catch {
      return c.json({ path: filePath, diff: "" });
    }
  });

  // ── Git: status (for editor file tree badges) ──────────────────────
  app.get("/api/git/status", (c) => {
    try {
      // Limited to the workspace (`-- .`, literal) and re-rooted onto it:
      // porcelain paths are repository-relative, so a workspace nested in a
      // larger repository would otherwise list — and mis-key — files outside it.
      const run = (args: string[]) => execFileSync("git", ["--literal-pathspecs", "-c", "core.quotePath=false", ...args], { cwd: workspace, encoding: "utf-8", timeout: 10_000, stdio: ["pipe", "pipe", "pipe"] });
      const prefix = run(["rev-parse", "--show-prefix"]).trim();
      const output = run(["status", "--porcelain", "--", "."]).trimEnd();
      const statuses: Record<string, string> = {};
      for (const line of output.split("\n").filter(Boolean)) {
        const status = line.substring(0, 2).trim();
        let filePath = line.substring(3);
        // Git wraps paths containing special chars in quotes — strip them
        if (filePath.startsWith('"') && filePath.endsWith('"')) {
          filePath = filePath.slice(1, -1);
        }
        if (prefix && filePath.startsWith(prefix)) filePath = filePath.slice(prefix.length);
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
  //
  // The stateDir tells the dashboard endpoints where proposals live on
  // disk:
  //   - personal `evolve`: per-session stateDir (workspace's `.pneuma/`
  //     for quick sessions; project session dir for project sessions —
  //     same dir the agent wrote to).
  //   - `project-evolve`: the project's `<root>/.pneuma/`, NOT the
  //     session's stateDir. The agent writes proposals to the project
  //     root so they're visible across sibling sessions and apply runs
  //     against project-level files.
  if (options.modeName === "evolve") {
    registerEvolutionRoutes(app, { workspace, stateDir: options.stateDir });
  } else if (options.modeName === "project-evolve") {
    // For project-evolve, route both the proposals list AND the apply
    // target at the project root. The per-session `workspace` is the
    // session dir for project sessions, so passing it through would
    // make Apply write `change.file` paths into the session's own
    // `.pneuma/` instead of the project's. Substitute projectRoot so
    // `applyProposal(workspace, ...)` resolves `change.file` against
    // the user-facing project tree.
    const evolveWorkspace = options.pneumaProjectRoot ?? workspace;
    const evolveStateDir = options.pneumaProjectRoot
      ? join(options.pneumaProjectRoot, ".pneuma")
      : options.stateDir;
    registerEvolutionRoutes(app, {
      workspace: evolveWorkspace,
      stateDir: evolveStateDir,
    });
  }

  // ── Reverse proxy for viewer API access ────────────────────────────────
  app.all("/proxy/*", createProxyMiddleware(proxyConfigRef));

  // ── Static content serving (workspace files) ──────────────────────────
  // CORS needed for slide thumbnail capture: Vite dev server (different port)
  // fetches images via inlineImagesInHtml() before passing to snapdom.
  app.use("/content/*", cors({ origin: "*" }));
  mountContentRoute(app, {
    contentRoot: serverReplayMode
      ? join(options.stateDir ?? join(workspace, ".pneuma"), "replay-checkout")
      : workspace,
  });

  // ── External mode bundle serving (production) ───────────────────────
  if (options.modeBundleDir) {
    const bundleDir = options.modeBundleDir;

    // Vendor shims — the host ABI declared in snapshot/mode-build.ts. Each
    // shim re-exports a host singleton from a window global that
    // src/main.tsx sets before the mode bundle loads, and the importmap
    // below maps the bare specifiers Bun.build left external onto these
    // URLs. Both tables come from the builder so a bundle can never be
    // compiled against an ABI this server does not serve.
    for (const [url, source] of Object.entries(HOST_ABI_VENDOR_SHIMS)) {
      app.get(url, () => new Response(source, { headers: { "Content-Type": "application/javascript" } }));
    }

    // Serve compiled mode bundle (JS + CSS, plus the assets Bun.build emits
    // beside them). A `.wasm` must go out as application/wasm:
    // `WebAssembly.instantiateStreaming` rejects any other type, which is how
    // the sprite viewer's Rive runtime loads the file it ships with.
    app.get("/mode-assets/*", async (c) => {
      const relPath = c.req.path.replace("/mode-assets/", "");
      const filePath = join(bundleDir, relPath);
      if (!isContained(filePath, bundleDir)) return c.notFound();
      const file = Bun.file(filePath);
      if (await file.exists()) {
        const contentType = relPath.endsWith(".css")
          ? "text/css"
          : relPath.endsWith(".wasm")
            ? "application/wasm"
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
${JSON.stringify(hostAbiImportMap())}
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
  let server: ReturnType<typeof Bun.serve<SocketData>>;
  let serverPort: number;
  try {
    ({ server, port: serverPort } = await bindFirstFreePort(port, MAX_PORT_ATTEMPTS, (candidate) =>
      Bun.serve<SocketData>({
        port: candidate,
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
      }),
    ));
  } catch (err) {
    // Nothing is listening: release what was started for this session.
    unsubscribeProxy?.();
    handoffRoutesContext.stop();
    borrowRoutesContext.stop();
    await shutdownProjectCache().catch(() => {});
    throw err;
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

  /**
   * `exiting`: the process is about to exit, so the OS releases every watch.
   * The project-cache watchers are then left open: closing chokidar's
   * per-path watches (`PNEUMA_WATCHER=chokidar`) costs one FSEventStream
   * rebuild each on macOS — 0.8 s for 20 small projects, 2.7 s on a real
   * registry — and `bin`'s shutdown kills the agent only after this returns,
   * under a 4 s force-exit fuse. Without it (tests, embedding callers) they
   * are closed so nothing outlives the server. The workspace watcher belongs
   * to the caller that created it.
   */
  const cleanup = async (opts: { exiting?: boolean } = {}) => {
    if (handoffRoutesContext) handoffRoutesContext.stop();
    if (borrowRoutesContext) borrowRoutesContext.stop();
    await hookBus.emit("session:end", { sessionId: sessionInfo.sessionId, mode: sessionInfo.mode, workspace }, sessionInfo).catch(() => {});
    if (!opts.exiting) await shutdownProjectCache().catch(() => {});
  };

  return { server, wsBridge, terminalManager, port: serverPort, modeMakerCleanup, onReplayContinue, onEditingLaunch, onEditingKill, cleanup, sessionInfo, hookBus, queueContentUpdate };
}
