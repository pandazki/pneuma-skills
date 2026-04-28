import type { Hono } from "hono";
import { existsSync } from "node:fs";
import { unlink, readFile, writeFile, rm } from "node:fs/promises";
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
import { parseHandoffMarkdown } from "./handoff-parser.js";
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
  /**
   * Optional. If provided, `/api/handoffs/:id/confirm` will use this to
   * terminate the source session's backend before spawning the target.
   * Failures are logged and ignored — the user clicking Confirm intends
   * to leave that session anyway.
   */
  killSession?: (sessionId: string) => Promise<void>;
  /**
   * Optional. If provided, `/api/handoffs/:id/confirm` will use this to
   * spawn the target session and return the URL the browser should
   * navigate to. Production wires this to the same machinery used by
   * `/api/launch`.
   */
  launchSession?: (params: {
    mode: string;
    project: string;
    sessionId?: string;
  }) => Promise<string>;
}

export function mountProjectsRoutes(app: Hono, options: ProjectsRoutesOptions): void {
  const sessionsPath = join(options.homeDir, ".pneuma", "sessions.json");
  // Per-handoff_id single-flight lock. The handoff confirm endpoint kills
  // the source + spawns the target — running it twice for the same id
  // creates a duplicate target session. The HandoffCard already disables
  // its Confirm button while in flight, but a network retry / double-tab
  // could still race in. This Set is the server-side guard.
  const handoffsInFlight = new Set<string>();

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

  app.post("/api/handoffs/:id/cancel", async (c) => {
    const id = c.req.param("id");
    const project = c.req.query("project");
    if (!project) return c.json({ error: "project query param required" }, 400);
    const target = join(project, ".pneuma", "handoffs", `${id}.md`);
    if (!existsSync(target)) return c.json({ error: "handoff not found" }, 404);
    await unlink(target);
    return c.json({ cancelled: true });
  });

  app.post("/api/handoffs/:id/confirm", async (c) => {
    const id = c.req.param("id");
    const project = c.req.query("project");
    if (!project) return c.json({ error: "project query param required" }, 400);

    // Single-flight: if another request is already processing this handoff,
    // return a definite "in progress" instead of racing into a second
    // launchPneumaChild call. The lock is released in `finally` below.
    if (handoffsInFlight.has(id)) {
      return c.json({ error: "handoff already in progress" }, 409);
    }
    handoffsInFlight.add(id);
    try {
      const handoffPath = join(project, ".pneuma", "handoffs", `${id}.md`);
      if (!existsSync(handoffPath)) return c.json({ error: "handoff not found" }, 404);

      const raw = await readFile(handoffPath, "utf-8");
      const parsed = parseHandoffMarkdown(handoffPath, raw);
      if (!parsed) return c.json({ error: "invalid handoff frontmatter" }, 400);
      const { frontmatter: fm } = parsed;

      const sourceSessionId = fm.source_session;
      const targetMode = fm.target_mode;
      const targetSession =
        fm.target_session && fm.target_session !== "auto"
          ? fm.target_session
          : undefined;

      if (!targetMode) return c.json({ error: "target_mode missing" }, 400);

      // Kill source if running. Best-effort: the user intends to leave that
      // session, so a failure here shouldn't block the launch.
      if (sourceSessionId && options.killSession) {
        try {
          await options.killSession(sourceSessionId);
        } catch (err) {
          console.warn(`[handoff-confirm] kill source failed: ${err}`);
        }
      }

      // Append switched_out event to source history (best-effort).
      if (sourceSessionId) {
        const sourceHistoryPath = join(
          project,
          ".pneuma",
          "sessions",
          sourceSessionId,
          "history.json",
        );
        if (existsSync(sourceHistoryPath)) {
          try {
            const arr = JSON.parse(await readFile(sourceHistoryPath, "utf-8")) as unknown[];
            if (Array.isArray(arr)) {
              arr.push({
                type: "session_event",
                subtype: "switched_out",
                handoff_id: id,
                ts: Date.now(),
              });
              await writeFile(sourceHistoryPath, JSON.stringify(arr, null, 2), "utf-8");
            }
          } catch (err) {
            console.warn(`[handoff-confirm] write switched_out failed: ${err}`);
          }
        }
      }

      if (!options.launchSession) {
        return c.json({ error: "launch not configured" }, 500);
      }
      const launchUrl = await options.launchSession({
        mode: targetMode,
        project,
        sessionId: targetSession,
      });

      // Leave the handoff file in place — the target session's skill
      // installer reads it at boot to inject the `pneuma:handoff` block
      // into CLAUDE.md, and the target agent rms it after consuming. The
      // single-flight lock above + chokidar's add-only listening + the
      // HandoffCard button-disable in flight together prevent the
      // duplicate-spawn loop without server-side delete.
      return c.json({ confirmed: true, launchUrl, handoffId: id });
    } finally {
      handoffsInFlight.delete(id);
    }
  });
}
