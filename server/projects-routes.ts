import type { Hono } from "hono";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  type Dirent,
} from "node:fs";
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  loadProjectManifest,
  writeProjectManifest,
} from "../core/project-loader.js";
import {
  readSessionsFile,
  writeSessionsFile,
  upsertProject,
  archiveProject,
  restoreProject,
  type ProjectRegistryEntry,
} from "../bin/sessions-registry.js";
import { importSessionsIntoProject } from "./project-init-from-sessions.js";
import {
  getProjectCache,
  getProjectCacheSWR,
  primeProjectCache,
  revalidateProjectCache,
  type ProjectCacheEntry,
} from "./projects-cache.js";

/**
 * If `root` is git-managed, ensure `.pneuma/` is in `.gitignore` so the
 * user's repo doesn't track Pneuma session/preference state. No-op when
 * the project root isn't a git repo (greenfield directories), when the
 * pattern is already present, or on any I/O error (best-effort —
 * project creation should never fail because we couldn't tweak a
 * gitignore).
 *
 * `.git` can be a directory (regular repo) or a file (git worktree
 * pointing to a parent .git/), and either case counts as git-managed.
 */
function ensurePneumaIgnored(root: string): void {
  try {
    if (!existsSync(join(root, ".git"))) return;
    const gitignorePath = join(root, ".gitignore");
    let body = "";
    if (existsSync(gitignorePath)) {
      body = readFileSync(gitignorePath, "utf-8");
      // Match common variants: `.pneuma`, `.pneuma/`, `/.pneuma`, `/.pneuma/`.
      // We don't try to parse negations — if the user has `!.pneuma` for some
      // reason, leave their config alone.
      const lines = body.split(/\r?\n/);
      const alreadyIgnored = lines.some((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) return false;
        if (trimmed.startsWith("!")) return false;
        const stripped = trimmed.replace(/^\/+/, "").replace(/\/+$/, "");
        return stripped === ".pneuma";
      });
      if (alreadyIgnored) return;
    }
    const needsLeadingNewline = body.length > 0 && !body.endsWith("\n");
    const next =
      body +
      (needsLeadingNewline ? "\n" : "") +
      (body.length > 0 ? "\n" : "") +
      "# Pneuma session/preference state\n.pneuma/\n";
    writeFileSync(gitignorePath, next);
  } catch {
    // Best-effort. A failure here doesn't block project creation.
  }
}

/**
 * Augmented project record returned by `/api/projects`.
 * Adds runtime-derived fields (sessionCount, modeBreakdown, coverImageUrl)
 * on top of the persisted ProjectRegistryEntry shape.
 */
export interface ProjectListResponseEntry extends ProjectRegistryEntry {
  /** Number of sessions discovered under `<root>/.pneuma/sessions/`. */
  sessionCount: number;
  /** Sorted unique mode names across the project's sessions. */
  modeBreakdown: string[];
  /** URL to fetch the project cover image, only present if `cover.png` exists. */
  coverImageUrl?: string;
}

export interface ProjectsRoutesOptions {
  homeDir: string; // typically homedir(); for tests, override
}

export function mountProjectsRoutes(app: Hono, options: ProjectsRoutesOptions): void {
  const sessionsPath = join(options.homeDir, ".pneuma", "sessions.json");

  /**
   * Build the registry-row + cache-entry composite shape that the launcher
   * UI expects. Centralised so both cache-hit and cache-miss paths in
   * `/api/projects` produce identical responses.
   */
  const enrichFromCache = (
    p: ProjectRegistryEntry,
    entry: ProjectCacheEntry,
  ): ProjectListResponseEntry => {
    const modeBreakdown = Array.from(
      new Set(entry.sessions.map((r) => r.mode)),
    ).sort();
    const coverImageUrl = entry.hasCover
      ? `/api/projects/${encodeURIComponent(p.id)}/cover`
      : undefined;
    return {
      ...p,
      sessionCount: entry.sessions.length,
      modeBreakdown,
      ...(coverImageUrl ? { coverImageUrl } : {}),
    };
  };

  app.get("/api/projects", async (c) => {
    const data = await readSessionsFile(sessionsPath);
    // ?archived=true → only archived; ?archived=all → both; anything else
    // (including a missing param or an unknown value) → only non-archived.
    // Treating bad input as the default keeps the route forgiving — the
    // launcher's query string is the only caller in practice.
    const archivedParam = c.req.query("archived");
    const filtered =
      archivedParam === "true"
        ? data.projects.filter((p) => p.archived === true)
        : archivedParam === "all"
          ? data.projects
          : data.projects.filter((p) => p.archived !== true);
    // Per-project enrichment goes through the SWR cache: cache hits are
    // synchronous Map lookups (the warm path is <1ms even for big registries),
    // misses fall back to a one-time scan that primes the cache + starts
    // the watcher. After the first hit, subsequent calls are instant and
    // chokidar keeps the entries fresh in the background.
    const enriched: ProjectListResponseEntry[] = await Promise.all(
      filtered.map(async (p) => {
        const cached = getProjectCache(p.root);
        if (cached) return enrichFromCache(p, cached);
        const fresh = await getProjectCacheSWR(p.root);
        return enrichFromCache(p, fresh);
      }),
    );
    // Surface `homeDir` so consumers (Project Panel, etc.) can shorten paths
    // with `~`. The launcher's `/api/sessions` already exposes this; mirroring
    // it here keeps path-shortening available inside per-session servers
    // (where `/api/sessions` isn't mounted).
    return c.json({ projects: enriched, homeDir: options.homeDir });
  });

  app.get("/api/projects/:id/cover", async (c) => {
    const id = decodeURIComponent(c.req.param("id"));
    // Only resolve for known projects to avoid arbitrary-path file reads.
    const data = await readSessionsFile(sessionsPath);
    const project = data.projects.find((p) => p.id === id || p.root === id);
    if (!project) return c.json({ error: "project not found" }, 404);
    const coverPath = join(project.root, ".pneuma", "cover.png");
    if (!existsSync(coverPath)) {
      return c.json({ error: "no cover image" }, 404);
    }
    const file = Bun.file(coverPath);
    return new Response(file, {
      headers: {
        "content-type": file.type || "image/png",
        // Hash-by-mtime via a short cache so swapping a cover.png picks up
        // without forcing a hard reload.
        "cache-control": "private, max-age=60",
      },
    });
  });

  app.post("/api/projects", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      root?: string;
      name?: string;
      displayName?: string;
      description?: string;
      initFromSessions?: string[];
    };
    if (!body.root || !body.name || !body.displayName) {
      return c.json({ error: "missing fields: root, name, displayName" }, 400);
    }
    const manifestPath = join(body.root, ".pneuma", "project.json");
    if (existsSync(manifestPath)) {
      return c.json({ error: "project already exists at this path" }, 409);
    }
    const now = Date.now();

    // Optional session import. We import first (it doesn't need the manifest
    // on disk yet) so that, if exactly one session is selected, the manifest
    // can record it as the founder.
    const initIds = Array.isArray(body.initFromSessions) ? body.initFromSessions : [];
    let importedSessions: Array<{
      sessionId: string;
      mode: string;
      displayName: string;
    }> = [];
    let founderSessionId: string | undefined;
    if (initIds.length > 0) {
      const result = await importSessionsIntoProject({
        projectRoot: body.root,
        sourceSessionIds: initIds,
        sessionsRegistryPath: sessionsPath,
        now,
      });
      importedSessions = result.imported.map((i) => ({
        sessionId: i.sessionId,
        mode: i.mode,
        displayName: i.displayName,
      }));
      if (result.imported.length === 1) {
        founderSessionId = result.imported[0].sessionId;
      }
    }

    await writeProjectManifest(body.root, {
      version: 1,
      name: body.name,
      displayName: body.displayName,
      description: body.description,
      createdAt: now,
      ...(founderSessionId ? { founderSessionId } : {}),
    });

    // Best-effort: if the user pointed Pneuma at an existing git repo,
    // add `.pneuma/` to its `.gitignore` so the per-session state we're
    // about to write doesn't pollute their working tree. Greenfield
    // directories (no `.git`) are skipped.
    ensurePneumaIgnored(body.root);

    // register in sessions.json projects[] — re-read because session import
    // already mutated and persisted the file.
    const data = await readSessionsFile(sessionsPath);
    const next = upsertProject(data, {
      id: body.root,
      name: body.name,
      displayName: body.displayName,
      description: body.description,
      root: body.root,
      createdAt: now,
      lastAccessed: now,
    });
    await writeSessionsFile(sessionsPath, next);

    // Prime the cache (initial scan + watcher) so the next /api/projects
    // call sees the new project without paying the cold scan cost on the
    // critical path. Fire-and-forget — the create response doesn't need
    // to wait on the watcher coming up.
    primeProjectCache(body.root).catch(() => {});

    return c.json({
      created: true,
      root: body.root,
      importedSessions,
    });
  });

  app.post("/api/projects/:id/archive", async (c) => {
    const id = decodeURIComponent(c.req.param("id"));
    const data = await readSessionsFile(sessionsPath);
    const project = data.projects.find((p) => p.id === id || p.root === id);
    if (!project) return c.json({ error: "project not found" }, 404);
    // Resolve to the canonical id stored in the registry; the param may have
    // arrived as `root` instead.
    const next = archiveProject(data, project.id);
    await writeSessionsFile(sessionsPath, next);
    // Archive doesn't change the on-disk session set, but other consumers
    // expect the cache to stay coherent with the registry state. Fire-
    // and-forget so the response stays snappy.
    revalidateProjectCache(project.root).catch(() => {});
    return c.json({ archived: true });
  });

  app.post("/api/projects/:id/restore", async (c) => {
    const id = decodeURIComponent(c.req.param("id"));
    const data = await readSessionsFile(sessionsPath);
    const project = data.projects.find((p) => p.id === id || p.root === id);
    if (!project) return c.json({ error: "project not found" }, 404);
    const next = restoreProject(data, project.id);
    await writeSessionsFile(sessionsPath, next);
    revalidateProjectCache(project.root).catch(() => {});
    return c.json({ archived: false });
  });

  // Permanent delete — distinct from archive. Removes the project and
  // all sessions belonging to it from the registry, and wipes the
  // project's `<root>/.pneuma/` directory (sessions, preferences,
  // shadow-git, cover, etc.). The project root directory itself and any
  // user-owned files outside `.pneuma/` stay untouched — Pneuma never
  // owned them, and a user pointing the launcher at an existing repo
  // expects the rest of their working tree to remain.
  app.delete("/api/projects/:id", async (c) => {
    const id = decodeURIComponent(c.req.param("id"));
    const data = await readSessionsFile(sessionsPath);
    const project = data.projects.find((p) => p.id === id || p.root === id);
    if (!project) return c.json({ error: "project not found" }, 404);

    // Drop registry rows for the project + any sessions under it.
    const next = {
      ...data,
      projects: data.projects.filter((p) => p.id !== project.id),
      sessions: data.sessions.filter(
        (s) => !(s.kind === "project" && s.projectRoot === project.root),
      ),
    };
    await writeSessionsFile(sessionsPath, next);

    // Wipe `<root>/.pneuma/`. Best-effort — a missing dir is fine
    // (already cleaned), and a permission error surfaces to the caller
    // so the user knows they need to handle it manually.
    const pneumaDir = join(project.root, ".pneuma");
    let pneumaWiped = false;
    if (existsSync(pneumaDir)) {
      try {
        await rm(pneumaDir, { recursive: true, force: true });
        pneumaWiped = true;
      } catch (err) {
        // Registry is already updated, so the project is gone from the
        // user's perspective. Surface the disk error so they can clean
        // up manually if they want to.
        return c.json(
          {
            deleted: true,
            pneumaWiped: false,
            warning: `Removed from registry, but failed to delete .pneuma/: ${err instanceof Error ? err.message : String(err)}`,
          },
          200,
        );
      }
    }

    revalidateProjectCache(project.root).catch(() => {});
    return c.json({ deleted: true, pneumaWiped });
  });

  app.get("/api/projects/:id/sessions", async (c) => {
    const id = decodeURIComponent(c.req.param("id"));
    // SWR: warm cache → instant return + background revalidate.
    // Cold cache → synchronous scan + prime; that's the same wall-clock
    // cost as the pre-cache implementation, but only paid once per
    // project root over the lifetime of this server process.
    const entry = await getProjectCacheSWR(id);
    if (!entry.manifest) return c.json({ error: "not a project" }, 404);
    return c.json({
      project: { ...entry.manifest, root: id },
      sessions: entry.sessions,
    });
  });

  // Lists project-scoped preferences (existence + mtime, no body). The
  // ProjectOverview surfaces these as recency indicators — body content
  // is never returned because the web UI is observation-only; preferences
  // are agent-managed.
  app.get("/api/projects/:id/preferences", async (c) => {
    const id = decodeURIComponent(c.req.param("id"));
    const manifest = await loadProjectManifest(id);
    if (!manifest) return c.json({ error: "project not found" }, 404);
    const prefDir = join(id, ".pneuma", "preferences");
    if (!existsSync(prefDir)) return c.json({ preferences: [] });
    let entries: Dirent[] = [];
    try {
      entries = readdirSync(prefDir, { withFileTypes: true });
    } catch {
      return c.json({ preferences: [] });
    }
    const preferences: Array<{
      name: string;
      kind: string;
      modeLabel?: string;
      mtime: number;
    }> = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const stem = entry.name.replace(/\.md$/, "");
      let kind = stem;
      let modeLabel: string | undefined;
      if (stem === "profile") {
        kind = "profile";
      } else if (stem.startsWith("mode-")) {
        kind = stem;
        modeLabel = stem.slice("mode-".length);
      } else {
        // Unknown convention — surface as-is so the user can still see it.
        kind = stem;
      }
      let mtime = 0;
      try {
        mtime = statSync(join(prefDir, entry.name)).mtimeMs;
      } catch {
        // skip
      }
      preferences.push({ name: entry.name, kind, modeLabel, mtime });
    }
    // Most recent first.
    preferences.sort((a, b) => b.mtime - a.mtime);
    return c.json({ preferences });
  });

  app.get("/api/projects/:id/sessions/:sessionId/thumbnail", async (c) => {
    const id = decodeURIComponent(c.req.param("id"));
    const sessionId = decodeURIComponent(c.req.param("sessionId"));
    // Restrict to known projects + known sessions to prevent arbitrary
    // file reads via path traversal in the URL params. Same guard pattern
    // as `/cover` above.
    const manifest = await loadProjectManifest(id);
    if (!manifest) return c.json({ error: "project not found" }, 404);
    const sessionDir = join(id, ".pneuma", "sessions", sessionId);
    if (!existsSync(join(sessionDir, "session.json"))) {
      return c.json({ error: "session not found" }, 404);
    }
    const thumbPath = join(sessionDir, "thumbnail.png");
    if (!existsSync(thumbPath)) {
      return c.json({ error: "no thumbnail" }, 404);
    }
    const file = Bun.file(thumbPath);
    return new Response(file, {
      headers: {
        "content-type": file.type || "image/png",
        // Mirrors `/cover`: short cache so a refreshed thumbnail.png picks
        // up without forcing a hard reload.
        "cache-control": "private, max-age=60",
      },
    });
  });

  app.delete("/api/projects/:id/sessions/:sessionId", async (c) => {
    const id = decodeURIComponent(c.req.param("id"));
    const sessionId = decodeURIComponent(c.req.param("sessionId"));
    // Path containment + manifest gate: the session dir resolves cleanly
    // under the project's `.pneuma/sessions/`, and the project itself must
    // be a real Pneuma project (manifest present). This blocks `..` /
    // absolute-path traversal in the sessionId param.
    const manifest = await loadProjectManifest(id);
    if (!manifest) return c.json({ error: "project not found" }, 404);
    const sessionsRoot = resolve(join(id, ".pneuma", "sessions"));
    const sessionDir = resolve(join(sessionsRoot, sessionId));
    if (!sessionDir.startsWith(sessionsRoot + "/")) {
      return c.json({ error: "invalid session id" }, 400);
    }

    // Idempotent: drop the registry entry whether or not the dir exists.
    // A stale registry pointing at a vanished dir is exactly the state
    // the user wants delete to clean up. Same applies to a dir without a
    // matching registry row — the rm still runs.
    const data = await readSessionsFile(sessionsPath);
    const beforeCount = data.sessions.length;
    const next = {
      ...data,
      sessions: data.sessions.filter(
        (s) => !(s.kind === "project" && s.projectRoot === id && s.sessionId === sessionId),
      ),
    };
    const registryHadEntry = next.sessions.length < beforeCount;
    await writeSessionsFile(sessionsPath, next);

    let dirExisted = false;
    if (existsSync(sessionDir)) {
      dirExisted = true;
      try {
        await rm(sessionDir, { recursive: true, force: true });
      } catch (err) {
        console.warn(`[projects] rm session dir failed: ${err}`);
      }
    }

    // Only true 404 if there was nothing to clean up either way — the
    // panel passed an id we've never heard of.
    if (!registryHadEntry && !dirExisted) {
      return c.json({ error: "session not found" }, 404);
    }
    // Kick a revalidation so the panel's next refresh sees the deletion
    // before chokidar's `unlinkDir` event has propagated. The watcher
    // would catch it on its own, but the explicit nudge avoids a brief
    // window where the deleted session row reappears via stale cache.
    revalidateProjectCache(id).catch(() => {});
    return c.json({ deleted: true, dirExisted, registryHadEntry });
  });

  // ── System actions on the project (Finder / editor) ─────────────────
  // These live alongside project CRUD because they're scoped to a known
  // project (manifest gate prevents arbitrary path opens). Both the
  // launcher and per-session servers mount this module, so the
  // ProjectPanel's icons work whether the user is in the empty shell or
  // an active session.

  app.get("/api/system/editors", async (c) => {
    const { detectEditors } = await import("./editor-bridge.js");
    return c.json({ editors: detectEditors() });
  });

  app.get("/api/system/editors/:id/icon", async (c) => {
    const id = decodeURIComponent(c.req.param("id"));
    const { extractEditorIconPath } = await import("./editor-bridge.js");
    const pngPath = await extractEditorIconPath(id);
    if (!pngPath) return c.json({ error: "no icon" }, 404);
    return new Response(Bun.file(pngPath), {
      headers: {
        "content-type": "image/png",
        // Cache long: the on-disk filename embeds the .icns mtime, so an
        // app update produces a different URL automatically. The 404
        // path stays uncached so a freshly-installed editor shows up.
        "cache-control": "private, max-age=86400",
      },
    });
  });

  app.post("/api/projects/:id/reveal", async (c) => {
    const id = decodeURIComponent(c.req.param("id"));
    const manifest = await loadProjectManifest(id);
    if (!manifest) return c.json({ error: "project not found" }, 404);
    if (!existsSync(id)) {
      return c.json({ success: false, message: "Project directory missing" }, 410);
    }
    try {
      // macOS: `open <dir>` opens the directory in Finder. Linux/Windows:
      // mirror the existing system-bridge fallbacks (xdg-open, explorer).
      const cmd =
        process.platform === "darwin"
          ? ["open", id]
          : process.platform === "win32"
            ? ["explorer", id]
            : ["xdg-open", id];
      const proc = Bun.spawn(cmd, { stdout: "ignore", stderr: "pipe" });
      const code = await proc.exited;
      if (code !== 0) {
        const stderr = await new Response(proc.stderr).text();
        return c.json({ success: false, message: stderr.trim() || `exit ${code}` }, 500);
      }
      return c.json({ success: true });
    } catch (err) {
      return c.json(
        { success: false, message: err instanceof Error ? err.message : "Unknown error" },
        500,
      );
    }
  });

  // System affordance: open an arbitrary directory in the user's chosen
  // editor. Lives under `/api/system/` alongside the editor-detection
  // routes (`/api/system/editors`, `/api/system/editors/:id/icon`) — the
  // route is desktop-facing infrastructure, not a project operation.
  // Callers pass the path in the body so it doesn't have to be URL-
  // encoded twice (frontend encode + server decode), and so the route
  // path doesn't suggest a `/api/projects/:id/...` prefix that no longer
  // matches the behavior. Both ProjectPanel (project root) and
  // EditorPanel (per-session workspace) hit this same endpoint.
  app.post("/api/system/open-in-editor", async (c) => {
    const body = await c.req.json<{ editorId: string; path: string }>();
    if (!body.path) {
      return c.json({ success: false, message: "Missing path" }, 400);
    }
    if (!existsSync(body.path)) {
      return c.json({ success: false, message: "Directory not found" }, 404);
    }
    const { openInEditor } = await import("./editor-bridge.js");
    const result = await openInEditor(body.editorId, body.path);
    return c.json(result, result.success ? 200 : 500);
  });

  // Handoff endpoints (`/api/handoffs/{emit,confirm,cancel}`) live in
  // `server/handoff-routes.ts` and are mounted separately by the server.
  // They previously lived here under the v1 file-mediated protocol; the
  // tool-call rewrite (2026-04-28) split them out so the project-routes
  // file stays focused on project CRUD.
}
