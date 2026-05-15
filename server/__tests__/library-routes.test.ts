/**
 * Tests for `server/library-routes.ts`.
 *
 * Pattern: in-memory Hono app + an in-memory bridge that records broadcasts,
 * with `~/.pneuma/libraries/` re-rooted under a per-test tmpdir via the
 * shared `node:os` homedir mock.
 */

import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";

// ── Home directory mock (shared pattern with library-registry.test.ts) ──────
let currentHome = tmpdir();
mock.module("node:os", () => {
  const real = require("node:os");
  return {
    ...real,
    homedir: () => currentHome,
    default: { ...real, homedir: () => currentHome },
  };
});

import { registerLibraryRoutes } from "../library-routes.js";
import {
  detectRepoShape,
  linkLibrary,
  getLibraryDir,
  getLibrariesDir,
  readLibrary,
  setModeActivated,
} from "../../core/library-registry.js";
import { initLocalLibrary } from "../../core/library-publish.js";
import type { InstalledLibrary, LibraryManifest } from "../../core/types/library.js";

// ── Fixture helpers ─────────────────────────────────────────────────────────

function makeMode(dir: string, name: string, version: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "manifest.ts"),
    `export const manifest = { name: "${name}", version: "${version}" };\n`,
    "utf-8",
  );
}

function makeLibraryJson(repoDir: string, body: LibraryManifest): void {
  mkdirSync(repoDir, { recursive: true });
  writeFileSync(
    join(repoDir, "pneuma.library.json"),
    JSON.stringify(body, null, 2),
    "utf-8",
  );
}

interface RecordedBroadcast {
  type: string;
  [k: string]: unknown;
}

function makeApp(): {
  app: Hono;
  broadcasts: RecordedBroadcast[];
  projectRoot: string;
} {
  const app = new Hono();
  const broadcasts: RecordedBroadcast[] = [];
  // projectRoot is only used by /api/libraries/link → resolveModeOrLibrary
  // for the builtin / cache directory base. Tests that don't hit link
  // pass any directory; tests that do use a path that exists.
  const projectRoot = currentHome; // arbitrary; not exercised in most routes
  registerLibraryRoutes(
    app,
    {
      broadcastAll: (msg: unknown) => {
        broadcasts.push(msg as RecordedBroadcast);
      },
    },
    { projectRoot },
  );
  return { app, broadcasts, projectRoot };
}

/** Plant a fixture library on disk + register it via linkLibrary. */
function plantLibraryFixture(
  id: string,
  modes: { name: string; version: string }[],
): InstalledLibrary {
  const libDir = getLibraryDir(id);
  mkdirSync(libDir, { recursive: true });
  makeLibraryJson(libDir, {
    version: 1,
    name: id,
    displayName: id,
    modes: modes.map((m) => ({ path: m.name })),
  });
  for (const m of modes) makeMode(join(libDir, m.name), m.name, m.version);
  const shape = detectRepoShape(libDir, id);
  if (shape.kind !== "library") throw new Error("expected library shape");
  const report = linkLibrary(
    id,
    libDir,
    shape,
    { type: "local", path: libDir },
    "sha-fixture",
  );
  return report.library;
}

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "libroutes-"));
  currentHome = tmp;
  // Make sure the libraries root exists for listLibraries() readdir.
  mkdirSync(getLibrariesDir(), { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

// ── GET /api/libraries ──────────────────────────────────────────────────────

describe("GET /api/libraries", () => {
  test("empty when nothing is linked", async () => {
    const { app } = makeApp();
    const res = await app.fetch(new Request("http://x/api/libraries"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { libraries: InstalledLibrary[] };
    expect(body.libraries).toEqual([]);
  });

  test("returns linked fixture libraries", async () => {
    plantLibraryFixture("lib-a", [{ name: "alpha", version: "0.1.0" }]);
    plantLibraryFixture("lib-b", [{ name: "beta", version: "0.2.0" }]);

    const { app } = makeApp();
    const res = await app.fetch(new Request("http://x/api/libraries"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { libraries: InstalledLibrary[] };
    const ids = body.libraries.map((l) => l.id).sort();
    expect(ids).toEqual(["lib-a", "lib-b"]);
  });
});

// ── POST /api/libraries/:id/mode/:name/activate + /deactivate ───────────────

describe("POST /api/libraries/:id/mode/:name/activate", () => {
  test("flips activated to true, broadcasts libraries_updated", async () => {
    plantLibraryFixture("activ-lib", [{ name: "alpha", version: "0.1.0" }]);
    // Start by flipping it off so the route's true flip is observable.
    setModeActivated("activ-lib", "alpha", false);
    expect(readLibrary("activ-lib")!.modes[0].activated).toBe(false);

    const { app, broadcasts } = makeApp();
    const res = await app.fetch(
      new Request("http://x/api/libraries/activ-lib/mode/alpha/activate", {
        method: "POST",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { library: InstalledLibrary };
    expect(body.library.modes[0].activated).toBe(true);

    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0].type).toBe("libraries_updated");
  });

  test("500 when library is unknown", async () => {
    const { app } = makeApp();
    const res = await app.fetch(
      new Request("http://x/api/libraries/ghost/mode/alpha/activate", {
        method: "POST",
      }),
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/not found/);
  });
});

describe("POST /api/libraries/:id/mode/:name/deactivate", () => {
  test("flips activated to false, broadcasts", async () => {
    plantLibraryFixture("deact-lib", [{ name: "alpha", version: "0.1.0" }]);

    const { app, broadcasts } = makeApp();
    const res = await app.fetch(
      new Request("http://x/api/libraries/deact-lib/mode/alpha/deactivate", {
        method: "POST",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { library: InstalledLibrary };
    expect(body.library.modes[0].activated).toBe(false);
    expect(broadcasts.map((b) => b.type)).toContain("libraries_updated");
  });
});

// ── POST /api/libraries/:id/mode/:name/accept-update ────────────────────────

describe("POST /api/libraries/:id/mode/:name/accept-update", () => {
  test("bumps installedVersion to manifestVersion and broadcasts", async () => {
    plantLibraryFixture("acc-lib", [{ name: "alpha", version: "0.1.0" }]);
    // Simulate an upstream bump: rewrite the manifest + re-sync.
    const libDir = getLibraryDir("acc-lib");
    makeMode(join(libDir, "alpha"), "alpha", "0.3.0");
    const shape = detectRepoShape(libDir, "acc-lib");
    if (shape.kind !== "library") throw new Error("library expected");
    const { syncLibrary } = await import("../../core/library-registry.js");
    syncLibrary("acc-lib", shape, "sha-2");

    expect(readLibrary("acc-lib")!.modes[0].installedVersion).toBe("0.1.0");

    const { app, broadcasts } = makeApp();
    const res = await app.fetch(
      new Request("http://x/api/libraries/acc-lib/mode/alpha/accept-update", {
        method: "POST",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { library: InstalledLibrary };
    expect(body.library.modes[0].installedVersion).toBe("0.3.0");
    expect(broadcasts.map((b) => b.type)).toContain("libraries_updated");
  });
});

// ── DELETE /api/libraries/:id ───────────────────────────────────────────────

describe("DELETE /api/libraries/:id", () => {
  test("removes a linked library, returns { ok, removed: true }, broadcasts", async () => {
    plantLibraryFixture("rm-lib", [{ name: "alpha", version: "0.1.0" }]);
    expect(existsSync(getLibraryDir("rm-lib"))).toBe(true);

    const { app, broadcasts } = makeApp();
    const res = await app.fetch(
      new Request("http://x/api/libraries/rm-lib", { method: "DELETE" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; removed: boolean };
    expect(body.ok).toBe(true);
    expect(body.removed).toBe(true);
    expect(existsSync(getLibraryDir("rm-lib"))).toBe(false);
    expect(broadcasts.map((b) => b.type)).toContain("libraries_updated");
  });

  test("returns { ok, removed: false } when nothing to delete (still broadcasts)", async () => {
    const { app, broadcasts } = makeApp();
    const res = await app.fetch(
      new Request("http://x/api/libraries/never-linked", { method: "DELETE" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; removed: boolean };
    expect(body.removed).toBe(false);
    expect(broadcasts.map((b) => b.type)).toContain("libraries_updated");
  });
});

// ── POST /api/libraries/init ────────────────────────────────────────────────

describe("POST /api/libraries/init", () => {
  test("scaffolds a new library and broadcasts", async () => {
    const { app, broadcasts } = makeApp();
    const res = await app.fetch(
      new Request("http://x/api/libraries/init", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "new-lib",
          displayName: "New Library",
          description: "test",
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      library: InstalledLibrary;
      githubUrl?: string;
    };
    expect(body.library.id).toBe("new-lib");
    expect(body.library.name).toBe("new-lib");
    // No github sub-object was passed, so no githubUrl in response.
    expect(body.githubUrl).toBeUndefined();
    expect(broadcasts.map((b) => b.type)).toContain("libraries_updated");
    expect(existsSync(getLibraryDir("new-lib"))).toBe(true);
  });

  test("400 when name is missing", async () => {
    const { app } = makeApp();
    const res = await app.fetch(
      new Request("http://x/api/libraries/init", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(400);
  });

  test("400 when github.visibility is invalid", async () => {
    const { app } = makeApp();
    const res = await app.fetch(
      new Request("http://x/api/libraries/init", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "bad-vis",
          github: { name: "u/r", visibility: "secret" },
        }),
      }),
    );
    expect(res.status).toBe(400);
  });

  test("500 when init throws (e.g. duplicate name)", async () => {
    // Pre-existing library with the same id.
    initLocalLibrary({ name: "dup-init" });
    const { app } = makeApp();
    const res = await app.fetch(
      new Request("http://x/api/libraries/init", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "dup-init" }),
      }),
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/already exists/);
  });
});

// ── POST /api/libraries/:id/sync ────────────────────────────────────────────

describe("POST /api/libraries/:id/sync", () => {
  test("local-source library: returns a sync report without doing git fetch", async () => {
    plantLibraryFixture("sync-lib", [{ name: "alpha", version: "0.1.0" }]);

    const { app, broadcasts } = makeApp();
    const res = await app.fetch(
      new Request("http://x/api/libraries/sync-lib/sync", { method: "POST" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      report: {
        library: InstalledLibrary;
        added: string[];
        removed: string[];
        updated: { name: string; from: string; to: string }[];
        noop: boolean;
      };
    };
    expect(body.report).toBeDefined();
    expect(body.report.library.id).toBe("sync-lib");
    expect(Array.isArray(body.report.added)).toBe(true);
    expect(Array.isArray(body.report.removed)).toBe(true);
    expect(Array.isArray(body.report.updated)).toBe(true);
    expect(typeof body.report.noop).toBe("boolean");
    expect(broadcasts.map((b) => b.type)).toContain("libraries_updated");
  });

  test("404 when library is unknown", async () => {
    const { app } = makeApp();
    const res = await app.fetch(
      new Request("http://x/api/libraries/ghost-sync/sync", { method: "POST" }),
    );
    expect(res.status).toBe(404);
  });
});

// ── POST /api/libraries/link ────────────────────────────────────────────────

describe("POST /api/libraries/link", () => {
  test("500 with error message for an invalid github specifier", async () => {
    const { app } = makeApp();
    const res = await app.fetch(
      new Request("http://x/api/libraries/link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // github specifier without "/" → parseModeSpecifier throws.
        body: JSON.stringify({ specifier: "github:onlyone" }),
      }),
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/Invalid GitHub mode specifier|github:user/);
  });

  test("400 when specifier is missing", async () => {
    const { app } = makeApp();
    const res = await app.fetch(
      new Request("http://x/api/libraries/link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(400);
  });
});

// ── POST /api/libraries/:id/publish ─────────────────────────────────────────

describe("POST /api/libraries/:id/publish", () => {
  test("publishes a fixture source mode into a library, broadcasts", async () => {
    initLocalLibrary({ name: "pub-routes-lib" });
    const src = join(tmp, "external-src", "alpha");
    makeMode(src, "alpha", "0.1.0");

    const { app, broadcasts } = makeApp();
    const res = await app.fetch(
      new Request("http://x/api/libraries/pub-routes-lib/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourcePath: src }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      destDir: string;
      library: InstalledLibrary;
      added: boolean;
    };
    expect(body.added).toBe(true);
    expect(body.library.modes.map((m) => m.name)).toContain("alpha");
    expect(existsSync(join(body.destDir, "manifest.ts"))).toBe(true);
    expect(broadcasts.map((b) => b.type)).toContain("libraries_updated");
  });

  test("400 when sourcePath is missing", async () => {
    initLocalLibrary({ name: "missing-src-routes-lib" });
    const { app } = makeApp();
    const res = await app.fetch(
      new Request("http://x/api/libraries/missing-src-routes-lib/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(400);
  });

  test("500 when publish hits an underlying error (e.g. unknown library)", async () => {
    const src = join(tmp, "external-src-2", "alpha");
    makeMode(src, "alpha", "0.1.0");
    const { app } = makeApp();
    const res = await app.fetch(
      new Request("http://x/api/libraries/ghost-publish-lib/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourcePath: src }),
      }),
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/is not linked/);
  });
});

// ── POST /api/libraries/:id/push ────────────────────────────────────────────

describe("POST /api/libraries/:id/push", () => {
  test("500 when the library has no git repo", async () => {
    // Plant a library dir with a sidecar but no .git.
    const id = "no-git-routes-lib";
    const dir = getLibraryDir(id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "pneuma.library.json"),
      JSON.stringify({ version: 1, name: id, modes: [] }, null, 2),
    );
    const shape = detectRepoShape(dir, id);
    if (shape.kind !== "library") throw new Error("library expected");
    linkLibrary(id, dir, shape, { type: "local", path: dir }, null);

    const { app } = makeApp();
    const res = await app.fetch(
      new Request(`http://x/api/libraries/${id}/push`, { method: "POST" }),
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/no git repo|not linked/);
  });
});

// ── GET /api/github/status ──────────────────────────────────────────────────

describe("GET /api/github/status", () => {
  test("returns a well-formed GhStatus shape", async () => {
    const { app } = makeApp();
    const res = await app.fetch(new Request("http://x/api/github/status"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      installed: boolean;
      authenticated: boolean;
      version?: string;
      hint?: string;
      username?: string;
    };
    expect(typeof body.installed).toBe("boolean");
    expect(typeof body.authenticated).toBe("boolean");
  });
});
