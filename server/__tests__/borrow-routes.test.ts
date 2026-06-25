/**
 * Borrow routes — server layer of the peer / round-trip cross-mode handoff.
 *
 * Mirrors `handoff-routes.test.ts`: drives the real Hono routes with a
 * structural mock for the spawn / host-resolution / WS seams, and asserts the
 * observable behavior the contract promises:
 *
 *   - dispatch validates the brief, mints a borrow_id, writes the on-disk
 *     brief (with server-filled `return_via`) BEFORE spawning B, creates the
 *     in-memory `BorrowLink`, and spawns B in the background.
 *   - the concurrency cap (1 active per host) QUEUES extras rather than
 *     rejecting them; the queued borrow is promoted when the active one ends.
 *   - the return leg reads + validates `<Bdir>/borrow-result.json`, marks the
 *     link terminal, and enqueues a `<pneuma:borrow-returned>` system tag onto
 *     A's flush-on-idle queue (the non-interruptive poke).
 *
 * Behavior tests through the public route surface — not snapshots of internal
 * shape.
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import {
  mountBorrowRoutes,
  type BorrowWsBridgeLike,
  type BorrowRoutesContext,
} from "../borrow-routes.js";
import { type BorrowResult } from "../../core/types/borrow.js";

interface RecordedSignal {
  sessionId: string;
  tag: string;
}
interface RecordedBroadcast {
  sessionId: string;
  msg: { type: string } & Record<string, unknown>;
}

function makeMockBridge(): BorrowWsBridgeLike & {
  signals: RecordedSignal[];
  broadcasts: RecordedBroadcast[];
} {
  const signals: RecordedSignal[] = [];
  const broadcasts: RecordedBroadcast[] = [];
  return {
    signals,
    broadcasts,
    enqueueSystemSignal: (sessionId, tag) => {
      signals.push({ sessionId, tag });
    },
    broadcastToSession: (sessionId, msg) => {
      broadcasts.push({ sessionId, msg });
    },
  };
}

let home: string;
let projRoot: string;
let app: Hono;
let bridge: ReturnType<typeof makeMockBridge>;
let ctx: BorrowRoutesContext;
let launched: Array<{ mode: string; project?: string; sessionId: string; background?: boolean }>;
const HOST_URL = "http://localhost:17996";

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "pneuma-borrow-"));
  projRoot = join(home, "proj");
  await mkdir(join(projRoot, ".pneuma", "sessions", "A"), { recursive: true });
  await writeFile(
    join(projRoot, ".pneuma", "project.json"),
    JSON.stringify({ version: 1, name: "p", displayName: "P", createdAt: 1 }),
  );
  await writeFile(
    join(projRoot, ".pneuma", "sessions", "A", "session.json"),
    JSON.stringify({ sessionId: "A", mode: "webcraft", backendType: "claude-code", createdAt: 1 }),
  );

  app = new Hono();
  bridge = makeMockBridge();
  launched = [];

  ctx = mountBorrowRoutes(app, {
    wsBridge: bridge,
    hostSessionId: "A",
    hostServerUrl: HOST_URL,
    validateMode: (mode) => ["webcraft", "wordtaste", "illustrate"].includes(mode),
    resolveHost: async (hostSessionId) => {
      if (hostSessionId === "A") return { projectRoot: projRoot };
      return null;
    },
    launchBorrow: async (params) => {
      launched.push(params);
      return { sessionId: params.sessionId, url: `${HOST_URL}?session=${params.sessionId}` };
    },
    pruneIntervalMs: 60_000,
    borrowTtlMs: 60_000,
  });
});

afterEach(async () => {
  ctx.stop();
  await rm(home, { recursive: true, force: true });
});

// ── Helpers ──────────────────────────────────────────────────────────────

async function dispatch(body: Record<string, unknown>) {
  return app.request("/api/borrows/dispatch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function postReturn(borrowId: string) {
  return app.request("/api/borrows/return", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ borrow_id: borrowId }),
  });
}

/** Write a valid borrow-result.json into B's dir for the return leg. */
async function writeResult(borrowDir: string, result: BorrowResult) {
  await writeFile(join(borrowDir, "borrow-result.json"), JSON.stringify(result));
}

// ── Tracer bullet: dispatch happy path (project session) ───────────────────

describe("POST /api/borrows/dispatch", () => {
  test("validates, mints a borrow, writes the brief before spawn, links + spawns B", async () => {
    const res = await dispatch({
      mode: "wordtaste",
      brief: "Polish the hero copy in the user's voice; under 40 words.",
      inputs: [join(projRoot, "site", "index.html")],
      expects: "polished markdown + per-section change notes",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { borrow_id: string; state: string };
    expect(body.state).toBe("running");
    expect(body.borrow_id).toBeTruthy();

    // BorrowLink created in the in-memory map.
    const link = ctx.borrows.get(body.borrow_id);
    expect(link).toBeDefined();
    expect(link!.state).toBe("running");
    expect(link!.host_session_id).toBe("A");
    expect(link!.mode).toBe("wordtaste");
    expect(link!.project_root).toBe(projRoot);

    // Brief written at <Bdir>/.pneuma/borrow-brief.json (project placement),
    // carrying the server-filled return_via so B knows where to relay.
    const briefPath = join(link!.borrow_dir, ".pneuma", "borrow-brief.json");
    expect(existsSync(briefPath)).toBe(true);
    const brief = JSON.parse(await readFile(briefPath, "utf-8")) as {
      mode: string;
      brief: string;
      return_via: { borrow_id: string; host_server_url: string };
    };
    expect(brief.mode).toBe("wordtaste");
    expect(brief.return_via.borrow_id).toBe(body.borrow_id);
    expect(brief.return_via.host_server_url).toBe(HOST_URL);

    // B spawned in the background, project-scoped, with the minted id.
    expect(launched).toHaveLength(1);
    expect(launched[0]).toMatchObject({
      mode: "wordtaste",
      project: projRoot,
      sessionId: body.borrow_id,
      background: true,
    });
  });

  test("rejects a missing brief", async () => {
    const res = await dispatch({ mode: "wordtaste" });
    expect(res.status).toBe(400);
    expect(launched).toHaveLength(0);
  });

  test("rejects a missing mode", async () => {
    const res = await dispatch({ brief: "do a thing" });
    expect(res.status).toBe(400);
  });

  test("rejects an unknown mode (validated, never branched on)", async () => {
    const res = await dispatch({ mode: "no-such-mode", brief: "x" });
    expect(res.status).toBe(400);
    // No brief staged, no spawn for an invalid mode.
    expect(launched).toHaveLength(0);
    expect(ctx.borrows.size).toBe(0);
  });

  test("rejects inputs that escape the project root (traversal guard)", async () => {
    const res = await dispatch({
      mode: "wordtaste",
      brief: "polish",
      inputs: ["/etc/passwd"],
    });
    expect(res.status).toBe(400);
    expect(launched).toHaveLength(0);
    expect(ctx.borrows.size).toBe(0);
  });

  test("rejects in_place_targets that escape the project root", async () => {
    const res = await dispatch({
      mode: "wordtaste",
      brief: "rewrite",
      scope: "in-place",
      in_place_targets: [join(projRoot, "..", "outside.md")],
    });
    expect(res.status).toBe(400);
  });

  test("accepts inputs contained within the project root", async () => {
    const res = await dispatch({
      mode: "wordtaste",
      brief: "polish",
      inputs: [join(projRoot, "site", "copy.md")],
    });
    expect(res.status).toBe(200);
  });

  test("places a quick (no-project) borrow in an OS temp dir", async () => {
    // Re-mount with a host that resolves to no project root.
    ctx.stop();
    launched = [];
    app = new Hono();
    ctx = mountBorrowRoutes(app, {
      wsBridge: bridge,
      hostSessionId: "A",
      hostServerUrl: HOST_URL,
      validateMode: () => true,
      resolveHost: async () => ({}), // quick: no projectRoot
      launchBorrow: async (params) => {
        launched.push(params);
        return { sessionId: params.sessionId, url: "x" };
      },
      pruneIntervalMs: 60_000,
      borrowTtlMs: 60_000,
    });

    const res = await dispatch({ mode: "illustrate", brief: "draw a logo" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { borrow_id: string };
    const link = ctx.borrows.get(body.borrow_id)!;
    expect(link.project_root).toBeUndefined();
    expect(link.borrow_dir).toContain("pneuma-borrow-");
    // Brief still staged under the temp <Bdir>/.pneuma/.
    expect(existsSync(join(link.borrow_dir, ".pneuma", "borrow-brief.json"))).toBe(true);
    expect(launched[0].project).toBeUndefined();
  });
});

// ── Concurrency cap (OQ-5: 1 active per host; queue the rest) ──────────────

describe("concurrency cap", () => {
  test("queues a second dispatch instead of rejecting it; does not spawn B yet", async () => {
    const first = await dispatch({ mode: "wordtaste", brief: "first" });
    const second = await dispatch({ mode: "illustrate", brief: "second" });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200); // queued, NOT rejected
    const b1 = (await first.json()) as { borrow_id: string; state: string };
    const b2 = (await second.json()) as { borrow_id: string; state: string };

    expect(b1.state).toBe("running");
    expect(b2.state).toBe("queued");

    // Only the active borrow has spawned B; only it holds a BorrowLink (whose
    // contract state space has no "queued" — queued borrows wait off-map).
    expect(launched).toHaveLength(1);
    expect(launched[0].sessionId).toBe(b1.borrow_id);
    expect(ctx.borrows.get(b1.borrow_id)?.state).toBe("running");
    expect(ctx.borrows.has(b2.borrow_id)).toBe(false);
    expect(ctx.queueDepth()).toBe(1);
  });

  test("promotes the queued borrow when the active one returns", async () => {
    const first = await dispatch({ mode: "wordtaste", brief: "first" });
    const second = await dispatch({ mode: "illustrate", brief: "second" });
    const b1 = (await first.json()) as { borrow_id: string };
    const b2 = (await second.json()) as { borrow_id: string };

    // The active borrow B1 writes its result + returns.
    const link1 = ctx.borrows.get(b1.borrow_id)!;
    await writeResult(link1.borrow_dir, {
      borrow_id: b1.borrow_id,
      mode: "wordtaste",
      status: "completed",
      produced: [{ path: join(link1.borrow_dir, "polished.md"), kind: "markdown" }],
      change_notes: "tightened the hero line",
      produced_at: Date.now(),
    });
    const ret = await postReturn(b1.borrow_id);
    expect(ret.status).toBe(200);

    // B1 terminal; B2 promoted to running + spawned.
    expect(ctx.borrows.get(b1.borrow_id)?.state).toBe("completed");
    expect(ctx.borrows.get(b2.borrow_id)?.state).toBe("running");
    expect(launched.map((l) => l.sessionId)).toContain(b2.borrow_id);
    // The promoted borrow's brief is staged at promotion.
    const link2 = ctx.borrows.get(b2.borrow_id)!;
    expect(existsSync(join(link2.borrow_dir, ".pneuma", "borrow-brief.json"))).toBe(true);
  });
});

// ── Return leg (the non-interruptive poke + terminal marking) ──────────────

describe("POST /api/borrows/return", () => {
  async function dispatchOne(mode = "wordtaste") {
    const res = await dispatch({ mode, brief: "polish copy" });
    const { borrow_id } = (await res.json()) as { borrow_id: string };
    return borrow_id;
  }

  test("enqueues a <pneuma:borrow-returned> tag pointing at the result, marks completed", async () => {
    const id = await dispatchOne();
    const link = ctx.borrows.get(id)!;
    const resultPath = join(link.borrow_dir, "borrow-result.json");
    await writeResult(link.borrow_dir, {
      borrow_id: id,
      mode: "wordtaste",
      status: "completed",
      produced: [{ path: join(link.borrow_dir, "polished.md"), kind: "markdown", role: "polished-copy" }],
      change_notes: "tightened the hero line; warmed the CTA",
      produced_at: Date.now(),
    });

    const res = await postReturn(id);
    expect(res.status).toBe(200);
    expect(ctx.borrows.get(id)?.state).toBe("completed");

    // Exactly one system signal, addressed to the host, carrying the result
    // pointer so A reads the artifact + change_notes.
    expect(bridge.signals).toHaveLength(1);
    expect(bridge.signals[0].sessionId).toBe("A");
    const tag = bridge.signals[0].tag;
    expect(tag).toContain("<pneuma:borrow-returned");
    expect(tag).toContain(`borrow_id="${id}"`);
    expect(tag).toContain(`mode="wordtaste"`);
    expect(tag).toContain(`status="completed"`);
    expect(tag).toContain(`result_path="${resultPath}"`);
  });

  test("a failed result marks the link failed but still pokes A", async () => {
    const id = await dispatchOne("illustrate");
    const link = ctx.borrows.get(id)!;
    await writeResult(link.borrow_dir, {
      borrow_id: id,
      mode: "illustrate",
      status: "failed",
      produced: [],
      change_notes: "could not match the requested mark",
      open_questions: ["which asset should the logo echo?"],
      produced_at: Date.now(),
    });
    const res = await postReturn(id);
    expect(res.status).toBe(200);
    expect(ctx.borrows.get(id)?.state).toBe("failed");
    expect(bridge.signals).toHaveLength(1);
    expect(bridge.signals[0].tag).toContain(`status="failed"`);
  });

  test("a partial result is a non-failed terminal outcome", async () => {
    const id = await dispatchOne();
    const link = ctx.borrows.get(id)!;
    await writeResult(link.borrow_dir, {
      borrow_id: id,
      mode: "wordtaste",
      status: "partial",
      produced: [{ path: join(link.borrow_dir, "copy.md") }],
      change_notes: "edited two of three sections",
      produced_at: Date.now(),
    });
    const res = await postReturn(id);
    expect(res.status).toBe(200);
    // `partial` means B produced something useful — the link is `completed`,
    // not `failed`. The artifact's own `status` carries the partial nuance.
    expect(ctx.borrows.get(id)?.state).toBe("completed");
  });

  test("a return with no readable result still pokes A (failed), never hangs", async () => {
    const id = await dispatchOne();
    // No borrow-result.json written.
    const res = await postReturn(id);
    expect(res.status).toBe(200);
    expect(ctx.borrows.get(id)?.state).toBe("failed");
    expect(bridge.signals).toHaveLength(1);
  });

  test("404 on an unknown borrow id", async () => {
    const res = await postReturn("never-dispatched");
    expect(res.status).toBe(404);
    expect(bridge.signals).toHaveLength(0);
  });

  test("idempotent: a duplicate return on a terminal borrow is a no-op success", async () => {
    const id = await dispatchOne();
    const link = ctx.borrows.get(id)!;
    await writeResult(link.borrow_dir, {
      borrow_id: id,
      mode: "wordtaste",
      status: "completed",
      produced: [{ path: join(link.borrow_dir, "p.md") }],
      change_notes: "done",
      produced_at: Date.now(),
    });
    await postReturn(id);
    const dup = await postReturn(id);
    expect(dup.status).toBe(200);
    // Still exactly one poke — the duplicate didn't re-notify A.
    expect(bridge.signals).toHaveLength(1);
  });
});

// ── TTL prune (a borrow that never returns must not occupy the slot forever) ─

describe("TTL prune", () => {
  test("flips a stale running borrow to timed_out", async () => {
    ctx.stop();
    launched = [];
    app = new Hono();
    ctx = mountBorrowRoutes(app, {
      wsBridge: bridge,
      hostSessionId: "A",
      hostServerUrl: HOST_URL,
      validateMode: () => true,
      resolveHost: async () => ({ projectRoot: projRoot }),
      launchBorrow: async (params) => {
        launched.push(params);
        return { sessionId: params.sessionId, url: "x" };
      },
      pruneIntervalMs: 10,
      borrowTtlMs: 0, // immediately stale
    });

    const res = await dispatch({ mode: "wordtaste", brief: "long-running job" });
    const { borrow_id } = (await res.json()) as { borrow_id: string };
    expect(ctx.borrows.get(borrow_id)?.state).toBe("running");

    // Wait for at least one prune tick (interval 10ms, ttl 0 → stale at once).
    await new Promise((r) => setTimeout(r, 40));
    expect(ctx.borrows.get(borrow_id)?.state).toBe("timed_out");
  });
});
