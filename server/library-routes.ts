/**
 * Library routes — `/api/libraries/*` and `/api/github/status`.
 *
 * These are launcher-only endpoints: libraries are a launcher-wide concern,
 * not a per-session one. Mount once from the launcher block in
 * `server/index.ts`. Per-session servers do not need (and do not get)
 * these routes.
 *
 * Mutations broadcast `libraries_updated` over the WS bridge so any
 * connected browser tab can revalidate `GET /api/libraries` without polling.
 * The broadcast is fire-and-forget — frontends that don't get the tick
 * (e.g. nothing connected at the moment of the mutation) will see the new
 * state on their next focus-driven refetch.
 *
 * Error contract: every handler wraps its body in try/catch. Schema
 * validation errors return 400 with `{ error: msg }`; everything else
 * surfaces the underlying module's `.message` at 500. The library
 * registry / publish modules throw with already-actionable messages.
 */

import type { Hono } from "hono";
import {
  listLibraries,
  readLibrary,
  syncLibrary,
  setModeActivated,
  acceptModeUpdate,
  unlinkLibrary,
  getLibraryDir,
  detectRepoShape,
  type LibrarySyncReport,
} from "../core/library-registry.js";
import {
  initLocalLibrary,
  publishModeToLibrary,
  pushLibrary,
} from "../core/library-publish.js";
import { resolveModeOrLibrary } from "../core/mode-resolver.js";
import { detectGh, createRepo } from "../core/github-cli.js";
import type { WsBridge } from "./ws-bridge.js";
import type { BrowserIncomingMessage } from "./session-types.js";

/**
 * Subset of the WS bridge surface library routes touch — typed loosely so
 * tests can pass an in-memory mock with just `broadcastAll`. The signature
 * matches `WsBridge.broadcastAll` exactly so the launcher can hand the
 * concrete bridge in unchanged.
 */
export interface LibraryRoutesBridge {
  /**
   * System-wide broadcast across every connected browser. The launcher's
   * Libraries section listens for `libraries_updated` and revalidates.
   * Optional — if missing (e.g. tests), the helper is a no-op.
   */
  broadcastAll?: (msg: BrowserIncomingMessage) => void;
}

export interface RegisterLibraryRoutesOptions {
  /** Used by `resolveModeOrLibrary` for builtin resolution + cache dirs. */
  projectRoot: string;
  /**
   * Optional hook the launcher passes in to drop its in-memory
   * `/api/registry` cache. Library mutations change which modes appear
   * in `local[]` (activated library modes surface there); without this
   * invalidation the launcher Quick Start grid stays stale for up to
   * 60 seconds. Tests can omit this — registry caching is launcher-only.
   */
  invalidateRegistry?: () => void;
}

/**
 * Mount the library routes on the given Hono app. The launcher calls this
 * once during boot; per-session servers must not call it (libraries are
 * launcher-scoped state).
 */
export function registerLibraryRoutes(
  app: Hono,
  wsBridge: LibraryRoutesBridge,
  options: RegisterLibraryRoutesOptions,
): void {
  /**
   * Single fan-out for every library mutation: drop the launcher's
   * registry cache so a follow-up `GET /api/registry` sees the new
   * mode list, then push a `libraries_updated` WS tick so any open
   * Launcher tab refetches without polling. Order matters — cache
   * first, broadcast second — so the tick arrives at a frontend that
   * will hit a fresh registry on its next call.
   */
  const notifyLibrariesChanged = (): void => {
    try {
      options.invalidateRegistry?.();
    } catch (err) {
      console.warn(`[library-routes] registry invalidate failed: ${err}`);
    }
    if (typeof wsBridge.broadcastAll !== "function") return;
    try {
      const msg: BrowserIncomingMessage = {
        type: "libraries_updated",
        ts: Date.now(),
      };
      wsBridge.broadcastAll(msg);
    } catch (err) {
      console.warn(`[library-routes] broadcast failed: ${err}`);
    }
  };
  // Older name kept as a local alias so route handlers don't all need
  // re-edit; both invocations route through the new fan-out.
  const broadcastLibrariesUpdated = notifyLibrariesChanged;

  // GET /api/libraries ──────────────────────────────────────────────────
  app.get("/api/libraries", (c) => {
    try {
      const libraries = listLibraries();
      return c.json({ libraries });
    } catch (err) {
      return c.json({ error: errMsg(err) }, 500);
    }
  });

  // POST /api/libraries/link ────────────────────────────────────────────
  app.post("/api/libraries/link", async (c) => {
    let body: { specifier?: unknown };
    try {
      body = (await c.req.json().catch(() => ({}))) as { specifier?: unknown };
    } catch (err) {
      return c.json({ error: errMsg(err) }, 400);
    }
    const specifier = typeof body.specifier === "string" ? body.specifier.trim() : "";
    if (!specifier) {
      return c.json({ error: "specifier is required" }, 400);
    }
    try {
      const result = await resolveModeOrLibrary(specifier, options.projectRoot);
      broadcastLibrariesUpdated();
      if (result.kind === "library") {
        return c.json({
          kind: "library",
          report: result.report,
          libraryDir: result.libraryDir,
        });
      }
      return c.json({ kind: "single", resolved: result.resolved });
    } catch (err) {
      return c.json({ error: errMsg(err) }, 500);
    }
  });

  // POST /api/libraries/:id/sync ────────────────────────────────────────
  app.post("/api/libraries/:id/sync", async (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "library id is required" }, 400);
    try {
      const prev = readLibrary(id);
      if (!prev) return c.json({ error: `library ${id} not found` }, 404);

      const libDir = getLibraryDir(id);

      if (prev.source.type === "github") {
        const ref = prev.source.ref || "main";
        try {
          await runGit(["fetch", "origin", ref], libDir);
          await runGit(["checkout", `origin/${ref}`, "--force"], libDir);
        } catch (gitErr) {
          return c.json({ error: `git sync failed: ${errMsg(gitErr)}` }, 500);
        }
      }
      // For "local" and "url" sources, we don't advance the repo — local
      // libraries are author-side and just need a re-scan; url libraries
      // would require a fresh re-extract through the resolver's link path,
      // which the user can trigger via `/api/libraries/link` with the
      // original URL. Plain re-`detectRepoShape` keeps this endpoint
      // predictable for both.

      const shape = detectRepoShape(libDir, prev.name);
      if (shape.kind !== "library") {
        return c.json(
          { error: `library ${id} no longer looks like a library on disk` },
          500,
        );
      }
      const newSha =
        prev.source.type === "github" ? await readGitSha(libDir) : prev.sha;
      const report: LibrarySyncReport = syncLibrary(id, shape, newSha);
      broadcastLibrariesUpdated();
      return c.json({ report });
    } catch (err) {
      return c.json({ error: errMsg(err) }, 500);
    }
  });

  // POST /api/libraries/:id/mode/:name/activate ─────────────────────────
  app.post("/api/libraries/:id/mode/:name/activate", (c) => {
    const id = c.req.param("id");
    const name = c.req.param("name");
    if (!id || !name) {
      return c.json({ error: "library id and mode name are required" }, 400);
    }
    try {
      const library = setModeActivated(id, name, true);
      broadcastLibrariesUpdated();
      return c.json({ library });
    } catch (err) {
      return c.json({ error: errMsg(err) }, 500);
    }
  });

  // POST /api/libraries/:id/mode/:name/deactivate ───────────────────────
  app.post("/api/libraries/:id/mode/:name/deactivate", (c) => {
    const id = c.req.param("id");
    const name = c.req.param("name");
    if (!id || !name) {
      return c.json({ error: "library id and mode name are required" }, 400);
    }
    try {
      const library = setModeActivated(id, name, false);
      broadcastLibrariesUpdated();
      return c.json({ library });
    } catch (err) {
      return c.json({ error: errMsg(err) }, 500);
    }
  });

  // POST /api/libraries/:id/mode/:name/accept-update ────────────────────
  app.post("/api/libraries/:id/mode/:name/accept-update", (c) => {
    const id = c.req.param("id");
    const name = c.req.param("name");
    if (!id || !name) {
      return c.json({ error: "library id and mode name are required" }, 400);
    }
    try {
      const library = acceptModeUpdate(id, name);
      broadcastLibrariesUpdated();
      return c.json({ library });
    } catch (err) {
      return c.json({ error: errMsg(err) }, 500);
    }
  });

  // POST /api/libraries/:id/publish ─────────────────────────────────────
  app.post("/api/libraries/:id/publish", async (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "library id is required" }, 400);
    let body: { sourcePath?: unknown; name?: unknown; push?: unknown };
    try {
      body = (await c.req.json().catch(() => ({}))) as typeof body;
    } catch (err) {
      return c.json({ error: errMsg(err) }, 400);
    }
    const sourcePath =
      typeof body.sourcePath === "string" ? body.sourcePath.trim() : "";
    if (!sourcePath) {
      return c.json({ error: "sourcePath is required" }, 400);
    }
    const name = typeof body.name === "string" && body.name ? body.name : undefined;
    const push = body.push === true;
    try {
      const result = publishModeToLibrary({
        sourceModeDir: sourcePath,
        libraryId: id,
        ...(name ? { name } : {}),
        push,
      });
      broadcastLibrariesUpdated();
      return c.json(result);
    } catch (err) {
      return c.json({ error: errMsg(err) }, 500);
    }
  });

  // POST /api/libraries/:id/push ────────────────────────────────────────
  app.post("/api/libraries/:id/push", (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "library id is required" }, 400);
    try {
      pushLibrary(id);
      // No broadcast — push doesn't change local state.
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: errMsg(err) }, 500);
    }
  });

  // DELETE /api/libraries/:id ───────────────────────────────────────────
  app.delete("/api/libraries/:id", (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "library id is required" }, 400);
    try {
      const removed = unlinkLibrary(id);
      broadcastLibrariesUpdated();
      return c.json({ ok: true, removed });
    } catch (err) {
      return c.json({ error: errMsg(err) }, 500);
    }
  });

  // POST /api/libraries/init ────────────────────────────────────────────
  app.post("/api/libraries/init", async (c) => {
    let body: {
      name?: unknown;
      displayName?: unknown;
      description?: unknown;
      github?: unknown;
    };
    try {
      body = (await c.req.json().catch(() => ({}))) as typeof body;
    } catch (err) {
      return c.json({ error: errMsg(err) }, 400);
    }
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return c.json({ error: "name is required" }, 400);
    }
    const displayName =
      typeof body.displayName === "string" && body.displayName
        ? body.displayName
        : undefined;
    const description =
      typeof body.description === "string" && body.description
        ? body.description
        : undefined;

    // Optional github sub-object — validate shape before doing anything
    // destructive on disk.
    let githubOpts:
      | { name: string; visibility?: "public" | "private" }
      | undefined;
    if (body.github !== undefined && body.github !== null) {
      if (typeof body.github !== "object") {
        return c.json({ error: "github must be an object" }, 400);
      }
      const gh = body.github as Record<string, unknown>;
      const ghName = typeof gh.name === "string" ? gh.name.trim() : "";
      if (!ghName) {
        return c.json({ error: "github.name is required when github is set" }, 400);
      }
      const visibility = gh.visibility;
      if (
        visibility !== undefined &&
        visibility !== "public" &&
        visibility !== "private"
      ) {
        return c.json(
          { error: "github.visibility must be 'public' or 'private'" },
          400,
        );
      }
      githubOpts = {
        name: ghName,
        ...(visibility ? { visibility } : {}),
      };
    }

    try {
      const library = initLocalLibrary({
        name,
        ...(displayName ? { displayName } : {}),
        ...(description ? { description } : {}),
      });

      let githubUrl: string | undefined;
      if (githubOpts) {
        try {
          const repo = await createRepo({
            name: githubOpts.name,
            ...(githubOpts.visibility ? { visibility: githubOpts.visibility } : {}),
            sourcePath: getLibraryDir(library.id),
            ...(description ? { description } : {}),
          });
          githubUrl = repo.url;
        } catch (err) {
          // The library exists locally; surface the github failure but
          // don't roll back the local init — the user can fix gh auth and
          // retry `pneuma library push`.
          broadcastLibrariesUpdated();
          return c.json(
            {
              library,
              error: `library created locally, but GitHub setup failed: ${errMsg(err)}`,
            },
            500,
          );
        }
      }

      broadcastLibrariesUpdated();
      return c.json({
        library,
        ...(githubUrl ? { githubUrl } : {}),
      });
    } catch (err) {
      return c.json({ error: errMsg(err) }, 500);
    }
  });

  // GET /api/github/status ──────────────────────────────────────────────
  app.get("/api/github/status", async (c) => {
    try {
      const status = await detectGh();
      return c.json(status);
    } catch (err) {
      return c.json({ error: errMsg(err) }, 500);
    }
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────

const GIT_TIMEOUT_MS = 30_000;

/**
 * Run a git command and return stdout. Mirrors `mode-resolver.ts`'s helper;
 * inlined here so the routes module doesn't reach into the resolver's
 * private surface.
 */
async function runGit(args: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => {
      try {
        proc.kill();
      } catch {
        /* already exited */
      }
      reject(new Error(`git ${args[0]} timed out after ${GIT_TIMEOUT_MS}ms`));
    }, GIT_TIMEOUT_MS);
  });

  const exitCode = await Promise.race([proc.exited, timeout]);
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();

  if (exitCode !== 0) {
    throw new Error(`git ${args[0]} failed (code ${exitCode}): ${stderr}`);
  }
  return stdout;
}

async function readGitSha(cwd: string): Promise<string | null> {
  try {
    const out = await runGit(["rev-parse", "HEAD"], cwd);
    const sha = out.trim();
    return sha || null;
  } catch {
    return null;
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Re-export the bridge type for callers — the launcher passes its
// `WsBridge` directly, which satisfies `LibraryRoutesBridge`.
export type { WsBridge };
