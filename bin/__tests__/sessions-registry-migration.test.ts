import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readSessionsFile,
  writeSessionsFile,
  readSessionsFileSync,
  writeSessionsFileSync,
  upsertSession,
  upsertProject,
  pickSessionName,
  pickArchived,
  archiveProject,
  restoreProject,
} from "../sessions-registry.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pneuma-reg-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("sessions registry migration", () => {
  test("reads legacy array as object with kind=quick", async () => {
    const file = join(dir, "sessions.json");
    await writeFile(
      file,
      JSON.stringify([
        {
          id: "/ws::doc",
          mode: "doc",
          displayName: "doc-1",
          workspace: "/ws",
          backendType: "claude-code",
          lastAccessed: 1,
        },
      ])
    );
    const data = await readSessionsFile(file);
    expect(data.projects).toEqual([]);
    expect(data.sessions).toHaveLength(1);
    expect(data.sessions[0].kind).toBe("quick");
    expect(data.sessions[0].mode).toBe("doc");
  });

  test("reads new shape unchanged", async () => {
    const file = join(dir, "sessions.json");
    await writeFile(
      file,
      JSON.stringify({
        projects: [
          {
            id: "/proj",
            name: "p",
            displayName: "P",
            root: "/proj",
            createdAt: 1,
            lastAccessed: 1,
          },
        ],
        sessions: [
          {
            id: "/proj::abc",
            kind: "project",
            sessionId: "abc",
            projectRoot: "/proj",
            mode: "webcraft",
            displayName: "land",
            sessionDir: "/proj/.pneuma/sessions/abc",
            backendType: "claude-code",
            lastAccessed: 1,
          },
        ],
      })
    );
    const data = await readSessionsFile(file);
    expect(data.projects).toHaveLength(1);
    expect(data.sessions[0].kind).toBe("project");
  });

  test("returns empty if file does not exist", async () => {
    const data = await readSessionsFile(join(dir, "missing.json"));
    expect(data).toEqual({ projects: [], sessions: [] });
  });

  test("write then read round-trips new shape", async () => {
    const file = join(dir, "sessions.json");
    await writeSessionsFile(file, {
      projects: [],
      sessions: [
        {
          id: "/ws::doc",
          kind: "quick",
          mode: "doc",
          displayName: "d",
          workspace: "/ws",
          sessionDir: "/ws",
          backendType: "claude-code",
          lastAccessed: 1,
        },
      ],
    });
    const data = await readSessionsFile(file);
    expect(data.sessions).toHaveLength(1);
  });

  test("upsertSession prepends and respects cap", async () => {
    const file = join(dir, "sessions.json");
    let data = { projects: [], sessions: [] };
    for (let i = 0; i < 5; i++) {
      data = upsertSession(data, {
        id: `/ws${i}::doc`,
        kind: "quick",
        mode: "doc",
        displayName: `doc-${i}`,
        workspace: `/ws${i}`,
        sessionDir: `/ws${i}`,
        backendType: "claude-code",
        lastAccessed: i,
      });
    }
    expect(data.sessions).toHaveLength(5);
    expect(data.sessions[0].id).toBe("/ws4::doc"); // Most recent first

    // Upsert again and check cap
    data = upsertSession(
      data,
      {
        id: "/ws5::doc",
        kind: "quick",
        mode: "doc",
        displayName: "doc-5",
        workspace: "/ws5",
        sessionDir: "/ws5",
        backendType: "claude-code",
        lastAccessed: 5,
      },
      3
    );
    expect(data.sessions).toHaveLength(3);
    expect(data.sessions[0].id).toBe("/ws5::doc");
  });

  test("upsertSession updates existing entry in place", async () => {
    let data = {
      projects: [],
      sessions: [
        {
          id: "/ws::doc",
          kind: "quick",
          mode: "doc",
          displayName: "old",
          workspace: "/ws",
          sessionDir: "/ws",
          backendType: "claude-code",
          lastAccessed: 1,
        },
      ],
    };
    data = upsertSession(data, {
      id: "/ws::doc",
      kind: "quick",
      mode: "doc",
      displayName: "updated",
      workspace: "/ws",
      sessionDir: "/ws",
      backendType: "claude-code",
      lastAccessed: 2,
    });
    expect(data.sessions).toHaveLength(1);
    expect(data.sessions[0].displayName).toBe("updated");
    expect(data.sessions[0].lastAccessed).toBe(2);
  });

  test("upsertProject prepends", async () => {
    let data = { projects: [], sessions: [] };
    data = upsertProject(data, {
      id: "/proj1",
      name: "p1",
      displayName: "P1",
      root: "/proj1",
      createdAt: 1,
      lastAccessed: 1,
    });
    data = upsertProject(data, {
      id: "/proj2",
      name: "p2",
      displayName: "P2",
      root: "/proj2",
      createdAt: 2,
      lastAccessed: 2,
    });
    expect(data.projects).toHaveLength(2);
    expect(data.projects[0].id).toBe("/proj2"); // Most recent first
  });

  test("upsertProject updates existing entry", async () => {
    let data = {
      projects: [
        {
          id: "/proj",
          name: "p",
          displayName: "P",
          root: "/proj",
          createdAt: 1,
          lastAccessed: 1,
        },
      ],
      sessions: [],
    };
    data = upsertProject(data, {
      id: "/proj",
      name: "p",
      displayName: "Updated P",
      root: "/proj",
      createdAt: 1,
      lastAccessed: 2,
    });
    expect(data.projects).toHaveLength(1);
    expect(data.projects[0].displayName).toBe("Updated P");
  });

  test("reconcile-style upgrade preserves existing projects array", async () => {
    const file = join(dir, "sessions.json");
    // Pre-populate with new schema containing a project
    await writeFile(
      file,
      JSON.stringify({
        projects: [
          {
            id: "/proj-keep",
            name: "keep",
            displayName: "Keep",
            root: "/proj-keep",
            createdAt: 1,
            lastAccessed: 1,
          },
        ],
        sessions: [],
      })
    );

    // Simulate the reconcile flow (read all, modify sessions, write back)
    const data = await readSessionsFile(file);
    data.sessions.push({
      id: "/ws::doc",
      kind: "quick",
      mode: "doc",
      displayName: "d",
      workspace: "/ws",
      sessionDir: "/ws",
      backendType: "claude-code",
      lastAccessed: 1,
    });
    await writeSessionsFile(file, data);

    // Reload and confirm projects survived
    const after = await readSessionsFile(file);
    expect(after.projects).toHaveLength(1);
    expect(after.projects[0].id).toBe("/proj-keep");
    expect(after.sessions).toHaveLength(1);
  });

  test("sync sibling readSessionsFileSync upgrades legacy array", () => {
    const file = join(dir, "sessions.json");
    const fs = require("node:fs");
    fs.writeFileSync(
      file,
      JSON.stringify([
        {
          id: "/ws::doc",
          mode: "doc",
          displayName: "doc-legacy",
          workspace: "/ws",
          backendType: "claude-code",
          lastAccessed: 7,
        },
      ])
    );
    const data = readSessionsFileSync(file);
    expect(data.projects).toEqual([]);
    expect(data.sessions).toHaveLength(1);
    expect(data.sessions[0].kind).toBe("quick");
    expect(data.sessions[0].displayName).toBe("doc-legacy");
  });

  test("sync writeSessionsFileSync round-trips through readSessionsFileSync", () => {
    const file = join(dir, "sessions-sync.json");
    writeSessionsFileSync(file, {
      projects: [
        {
          id: "/proj",
          name: "p",
          displayName: "P",
          root: "/proj",
          createdAt: 1,
          lastAccessed: 1,
        },
      ],
      sessions: [
        {
          id: "/ws::doc",
          kind: "quick",
          mode: "doc",
          displayName: "d",
          workspace: "/ws",
          sessionDir: "/ws",
          backendType: "claude-code",
          lastAccessed: 1,
        },
      ],
    });
    const data = readSessionsFileSync(file);
    expect(data.projects).toHaveLength(1);
    expect(data.sessions).toHaveLength(1);
    expect(data.projects[0].displayName).toBe("P");
  });

  test("readSessionsFileSync returns empty when file missing", () => {
    const data = readSessionsFileSync(join(dir, "nope.json"));
    expect(data).toEqual({ projects: [], sessions: [] });
  });
});

describe("pickSessionName (Fix 2 — preserve rename across no-arg resume)", () => {
  test("incoming wins when present (initial set)", () => {
    expect(pickSessionName("Hero Page", undefined)).toBe("Hero Page");
  });

  test("incoming wins over existing (rename in same run)", () => {
    expect(pickSessionName("Renamed", "Old Name")).toBe("Renamed");
  });

  test("preserves existing when incoming is undefined (no --session-name on resume)", () => {
    expect(pickSessionName(undefined, "Hero Page")).toBe("Hero Page");
  });

  test("preserves existing when incoming is empty string (CLI default for unset)", () => {
    // The CLI parser stores --session-name's absence as `""`; the helper
    // must treat that the same as `undefined` or it would erase renames.
    expect(pickSessionName("", "Hero Page")).toBe("Hero Page");
  });

  test("returns undefined when both sides are absent", () => {
    expect(pickSessionName(undefined, undefined)).toBeUndefined();
    expect(pickSessionName("", undefined)).toBeUndefined();
  });

  test("end-to-end via upsert: rename survives a no-arg upsert", () => {
    // Simulates: user runs `pneuma doc --session-name "Hero Page"`, then
    // later `pneuma doc` (no --session-name). The registry entry should
    // keep "Hero Page" rather than going back to undefined.
    let data = upsertSession(
      { projects: [], sessions: [] },
      {
        id: "/ws::doc",
        kind: "quick",
        mode: "doc",
        displayName: "Doc",
        sessionName: "Hero Page",
        workspace: "/ws",
        sessionDir: "/ws",
        backendType: "claude-code",
        lastAccessed: 1,
      },
    );
    const existing = data.sessions.find((s) => s.id === "/ws::doc");
    const preservedName = pickSessionName(undefined, existing?.sessionName);
    data = upsertSession(data, {
      id: "/ws::doc",
      kind: "quick",
      mode: "doc",
      displayName: "Doc",
      sessionName: preservedName,
      workspace: "/ws",
      sessionDir: "/ws",
      backendType: "claude-code",
      lastAccessed: 2,
    });
    expect(data.sessions[0].sessionName).toBe("Hero Page");
    expect(data.sessions[0].lastAccessed).toBe(2);
  });
});

describe("project archive (Phase 4 — soft-delete)", () => {
  test("pickArchived: incoming wins when explicitly set", () => {
    expect(pickArchived(true, undefined)).toBe(true);
    expect(pickArchived(false, true)).toBe(false);
    expect(pickArchived(true, false)).toBe(true);
  });

  test("pickArchived: preserves existing when incoming is undefined", () => {
    expect(pickArchived(undefined, true)).toBe(true);
    expect(pickArchived(undefined, false)).toBe(false);
    expect(pickArchived(undefined, undefined)).toBeUndefined();
  });

  test("upsertProject preserves archived: true when incoming has no archived field", () => {
    let data = upsertProject(
      { projects: [], sessions: [] },
      {
        id: "/proj",
        name: "p",
        displayName: "P",
        root: "/proj",
        createdAt: 1,
        lastAccessed: 1,
        archived: true,
      },
    );
    // Resume-style upsert: launcher rebuilds the entry without an archived
    // field. The registry must keep the prior flag.
    data = upsertProject(data, {
      id: "/proj",
      name: "p",
      displayName: "P",
      root: "/proj",
      createdAt: 1,
      lastAccessed: 2,
    });
    expect(data.projects).toHaveLength(1);
    expect(data.projects[0].archived).toBe(true);
    expect(data.projects[0].lastAccessed).toBe(2);
  });

  test("upsertProject without archived on either side never writes archived: false", () => {
    let data = upsertProject(
      { projects: [], sessions: [] },
      {
        id: "/fresh",
        name: "f",
        displayName: "F",
        root: "/fresh",
        createdAt: 1,
        lastAccessed: 1,
      },
    );
    expect("archived" in data.projects[0]).toBe(false);
    // A resume should not introduce the property either.
    data = upsertProject(data, {
      id: "/fresh",
      name: "f",
      displayName: "F",
      root: "/fresh",
      createdAt: 1,
      lastAccessed: 2,
    });
    expect("archived" in data.projects[0]).toBe(false);
  });

  test("archiveProject flips just the targeted project", () => {
    const data = archiveProject(
      {
        projects: [
          { id: "/a", name: "a", displayName: "A", root: "/a", createdAt: 1, lastAccessed: 1 },
          { id: "/b", name: "b", displayName: "B", root: "/b", createdAt: 2, lastAccessed: 2 },
          { id: "/c", name: "c", displayName: "C", root: "/c", createdAt: 3, lastAccessed: 3 },
        ],
        sessions: [],
      },
      "/b",
    );
    expect(data.projects.find((p) => p.id === "/a")?.archived).toBeUndefined();
    expect(data.projects.find((p) => p.id === "/b")?.archived).toBe(true);
    expect(data.projects.find((p) => p.id === "/c")?.archived).toBeUndefined();
  });

  test("restoreProject clears the archived flag (omits, not false)", () => {
    const data = restoreProject(
      {
        projects: [
          { id: "/a", name: "a", displayName: "A", root: "/a", createdAt: 1, lastAccessed: 1, archived: true },
        ],
        sessions: [],
      },
      "/a",
    );
    const entry = data.projects[0];
    expect(entry.archived).toBeUndefined();
    expect("archived" in entry).toBe(false);
  });

  test("archiveProject / restoreProject are no-ops for unknown ids", () => {
    const before: import("../sessions-registry.js").SessionsFile = {
      projects: [
        { id: "/a", name: "a", displayName: "A", root: "/a", createdAt: 1, lastAccessed: 1 },
      ],
      sessions: [],
    };
    const archivedNoOp = archiveProject(before, "/missing");
    const restoredNoOp = restoreProject(before, "/missing");
    expect(archivedNoOp.projects[0]).toEqual(before.projects[0]);
    expect(restoredNoOp.projects[0]).toEqual(before.projects[0]);
  });

  test("legacy entries without archived are read as not-archived", async () => {
    const file = join(dir, "sessions.json");
    await writeFile(
      file,
      JSON.stringify({
        projects: [
          {
            id: "/legacy",
            name: "legacy",
            displayName: "Legacy",
            root: "/legacy",
            createdAt: 1,
            lastAccessed: 1,
          },
        ],
        sessions: [],
      }),
    );
    const data = await readSessionsFile(file);
    expect(data.projects).toHaveLength(1);
    expect(data.projects[0].archived).toBeUndefined();
  });

  test("round-trip: archive → write → read keeps the flag", async () => {
    const file = join(dir, "sessions.json");
    let data = upsertProject(
      { projects: [], sessions: [] },
      {
        id: "/p",
        name: "p",
        displayName: "P",
        root: "/p",
        createdAt: 1,
        lastAccessed: 1,
      },
    );
    data = archiveProject(data, "/p");
    await writeSessionsFile(file, data);
    const reloaded = await readSessionsFile(file);
    expect(reloaded.projects).toHaveLength(1);
    expect(reloaded.projects[0].archived).toBe(true);
  });
});
