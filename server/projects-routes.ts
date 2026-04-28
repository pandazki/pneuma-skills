import type { Hono } from "hono";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  loadProjectManifest,
  scanProjectSessions,
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
    const enriched: ProjectListResponseEntry[] = await Promise.all(
      filtered.map(async (p) => {
        // scanProjectSessions tolerates a missing sessions directory and
        // returns []; per-project IO is bounded by the registry cap (50).
        const refs = await scanProjectSessions(p.root).catch(() => []);
        const modeBreakdown = Array.from(
          new Set(refs.map((r) => r.mode))
        ).sort();
        const coverPath = join(p.root, ".pneuma", "cover.png");
        const coverImageUrl = existsSync(coverPath)
          ? `/api/projects/${encodeURIComponent(p.id)}/cover`
          : undefined;
        return {
          ...p,
          sessionCount: refs.length,
          modeBreakdown,
          ...(coverImageUrl ? { coverImageUrl } : {}),
        };
      })
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
    return c.json({ archived: true });
  });

  app.post("/api/projects/:id/restore", async (c) => {
    const id = decodeURIComponent(c.req.param("id"));
    const data = await readSessionsFile(sessionsPath);
    const project = data.projects.find((p) => p.id === id || p.root === id);
    if (!project) return c.json({ error: "project not found" }, 404);
    const next = restoreProject(data, project.id);
    await writeSessionsFile(sessionsPath, next);
    return c.json({ archived: false });
  });

  app.get("/api/projects/:id/sessions", async (c) => {
    const id = decodeURIComponent(c.req.param("id"));
    const manifest = await loadProjectManifest(id);
    if (!manifest) return c.json({ error: "not a project" }, 404);
    const refs = await scanProjectSessions(id);
    return c.json({
      project: { ...manifest, root: id },
      sessions: refs,
    });
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
    return c.json({ deleted: true, dirExisted, registryHadEntry });
  });

  // Handoff endpoints (`/api/handoffs/{emit,confirm,cancel}`) live in
  // `server/handoff-routes.ts` and are mounted separately by the server.
  // They previously lived here under the v1 file-mediated protocol; the
  // tool-call rewrite (2026-04-28) split them out so the project-routes
  // file stays focused on project CRUD.
}
