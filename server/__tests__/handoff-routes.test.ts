import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import {
  mountHandoffRoutes,
  pruneExpiredProposals,
  escapeXmlAttr,
  type HandoffWsBridgeLike,
  type HandoffProposal,
} from "../handoff-routes.js";

interface RecordedBroadcast {
  sessionId: string;
  msg: { type: string } & Record<string, unknown>;
}

function makeMockBridge(): HandoffWsBridgeLike & {
  broadcasts: RecordedBroadcast[];
  userMessages: Array<{ sessionId: string; content: string }>;
} {
  const broadcasts: RecordedBroadcast[] = [];
  const userMessages: Array<{ sessionId: string; content: string }> = [];
  return {
    broadcasts,
    userMessages,
    broadcastToSession: (sessionId, msg) => {
      broadcasts.push({ sessionId, msg });
    },
    sendUserMessage: (sessionId, content) => {
      userMessages.push({ sessionId, content });
    },
  };
}

let home: string;
let projRoot: string;
let app: Hono;
let bridge: ReturnType<typeof makeMockBridge>;
let stop: () => void;
let launchedTargets: Array<{ mode: string; project: string; sessionId?: string }>;
let killedSources: string[];

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "pneuma-handoff-"));
  projRoot = join(home, "proj");
  await mkdir(join(projRoot, ".pneuma", "sessions", "src-1"), { recursive: true });
  await writeFile(
    join(projRoot, ".pneuma", "project.json"),
    JSON.stringify({ version: 1, name: "p", displayName: "P", createdAt: 1 }),
  );
  await writeFile(
    join(projRoot, ".pneuma", "sessions", "src-1", "session.json"),
    JSON.stringify({ sessionId: "src-1", mode: "doc", backendType: "claude-code", createdAt: 1 }),
  );
  await writeFile(
    join(projRoot, ".pneuma", "sessions", "src-1", "history.json"),
    JSON.stringify([]),
  );

  app = new Hono();
  bridge = makeMockBridge();
  launchedTargets = [];
  killedSources = [];

  const ctx = mountHandoffRoutes(app, {
    wsBridge: bridge,
    killSession: async (sid) => { killedSources.push(sid); },
    launchSession: async (params) => {
      launchedTargets.push(params);
      return `http://localhost:17080?session=${params.sessionId ?? "mock"}&mode=${params.mode}`;
    },
    resolveSource: async (sid) => {
      if (sid === "src-1") {
        return { projectRoot: projRoot, mode: "doc", displayName: "Source Doc" };
      }
      return null;
    },
    pruneIntervalMs: 60_000,
    pendingTtlMs: 60_000,
  });
  stop = ctx.stop;
});

afterEach(async () => {
  stop();
  await rm(home, { recursive: true, force: true });
});

describe("escapeXmlAttr", () => {
  test("escapes quotes / & / angle brackets", () => {
    expect(escapeXmlAttr(`it's "a" & <b>`)).toBe("it's &quot;a&quot; &amp; &lt;b&gt;");
  });
});

describe("pruneExpiredProposals", () => {
  test("flips pending proposals past TTL to timed_out", () => {
    const map = new Map<string, HandoffProposal>([
      [
        "stale",
        {
          handoff_id: "stale",
          source_session_id: "src",
          target_mode: "webcraft",
          intent: "x",
          proposed_at: 1_000,
          state: "pending",
        },
      ],
      [
        "fresh",
        {
          handoff_id: "fresh",
          source_session_id: "src",
          target_mode: "webcraft",
          intent: "y",
          proposed_at: 999_000,
          state: "pending",
        },
      ],
      [
        "already-confirmed",
        {
          handoff_id: "already-confirmed",
          source_session_id: "src",
          target_mode: "webcraft",
          intent: "z",
          proposed_at: 0,
          state: "confirmed",
        },
      ],
    ]);
    const flipped = pruneExpiredProposals(map, 1_000_000, 60_000);
    expect(flipped).toEqual(["stale"]);
    expect(map.get("stale")!.state).toBe("timed_out");
    expect(map.get("fresh")!.state).toBe("pending");
    expect(map.get("already-confirmed")!.state).toBe("confirmed");
  });
});

describe("POST /api/handoffs/emit", () => {
  test("creates a proposal + broadcasts handoff_proposed", async () => {
    const res = await app.request("/api/handoffs/emit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source_session_id: "src-1",
        target_mode: "webcraft",
        intent: "build a site",
        summary: "All set",
        suggested_files: ["a.md", "b.md"],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { handoff_id: string; status: string };
    expect(body.status).toBe("proposed");
    expect(body.handoff_id).toBeTruthy();

    expect(bridge.broadcasts).toHaveLength(1);
    expect(bridge.broadcasts[0].sessionId).toBe("src-1");
    expect(bridge.broadcasts[0].msg.type).toBe("handoff_proposed");
    expect((bridge.broadcasts[0].msg as { handoff_id: string }).handoff_id).toBe(body.handoff_id);
  });

  test("rejects missing target_mode", async () => {
    const res = await app.request("/api/handoffs/emit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source_session_id: "src-1", intent: "x" }),
    });
    expect(res.status).toBe(400);
  });

  test("rejects missing intent", async () => {
    const res = await app.request("/api/handoffs/emit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source_session_id: "src-1", target_mode: "webcraft" }),
    });
    expect(res.status).toBe(400);
  });

  test("rejects missing source_session_id", async () => {
    const res = await app.request("/api/handoffs/emit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target_mode: "webcraft", intent: "x" }),
    });
    expect(res.status).toBe(400);
  });

  test("supersedes earlier pending from same source", async () => {
    const r1 = await app.request("/api/handoffs/emit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source_session_id: "src-1", target_mode: "webcraft", intent: "first" }),
    });
    const r2 = await app.request("/api/handoffs/emit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source_session_id: "src-1", target_mode: "slide", intent: "second" }),
    });
    const id1 = ((await r1.json()) as { handoff_id: string }).handoff_id;
    const id2 = ((await r2.json()) as { handoff_id: string }).handoff_id;
    expect(id1).not.toBe(id2);
    // Confirming the old one should now 409 — it was superseded.
    const confirmOld = await app.request(`/api/handoffs/${id1}/confirm`, { method: "POST" });
    expect(confirmOld.status).toBe(409);
  });
});

describe("POST /api/handoffs/:id/confirm", () => {
  test("writes inbound-handoff.json before launchSession + spawns target", async () => {
    const emit = await app.request("/api/handoffs/emit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source_session_id: "src-1",
        target_mode: "webcraft",
        intent: "build a site",
        summary: "Brand established",
        suggested_files: ["brand/logo.svg"],
      }),
    });
    const id = ((await emit.json()) as { handoff_id: string }).handoff_id;

    const res = await app.request(`/api/handoffs/${id}/confirm`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { confirmed: boolean; launchUrl: string; target_session_id: string };
    expect(body.confirmed).toBe(true);
    expect(body.target_session_id).toBeTruthy();

    // inbound-handoff.json lives at <targetSessionDir>/.pneuma/inbound-handoff.json
    // (the target's agent reads + rms it on first turn).
    const inboundPath = join(
      projRoot,
      ".pneuma",
      "sessions",
      body.target_session_id,
      ".pneuma",
      "inbound-handoff.json",
    );
    expect(existsSync(inboundPath)).toBe(true);
    const inbound = JSON.parse(await readFile(inboundPath, "utf-8")) as {
      intent: string;
      source_mode: string;
      source_display_name: string;
      suggested_files: string[];
    };
    expect(inbound.intent).toBe("build a site");
    expect(inbound.source_mode).toBe("doc");
    expect(inbound.source_display_name).toBe("Source Doc");
    expect(inbound.suggested_files).toEqual(["brand/logo.svg"]);

    // launchSession was called with the target session id derived above.
    expect(launchedTargets).toHaveLength(1);
    expect(launchedTargets[0]).toMatchObject({
      mode: "webcraft",
      project: projRoot,
      sessionId: body.target_session_id,
    });

    // Source killed (best-effort); switched_out written to source history.
    expect(killedSources).toEqual(["src-1"]);
    const hist = JSON.parse(
      await readFile(join(projRoot, ".pneuma", "sessions", "src-1", "history.json"), "utf-8"),
    ) as Array<{ type?: string; subtype?: string }>;
    expect(hist.some((e) => e.type === "session_event" && e.subtype === "switched_out")).toBe(true);
  });

  test("404 unknown id", async () => {
    const res = await app.request("/api/handoffs/never-emitted/confirm", { method: "POST" });
    expect(res.status).toBe(404);
  });

  test("409 on duplicate confirm", async () => {
    const emit = await app.request("/api/handoffs/emit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source_session_id: "src-1", target_mode: "webcraft", intent: "x" }),
    });
    const id = ((await emit.json()) as { handoff_id: string }).handoff_id;
    const ok = await app.request(`/api/handoffs/${id}/confirm`, { method: "POST" });
    expect(ok.status).toBe(200);
    const dup = await app.request(`/api/handoffs/${id}/confirm`, { method: "POST" });
    expect(dup.status).toBe(409);
    // launchSession should have been called exactly once.
    expect(launchedTargets).toHaveLength(1);
  });

  test("uses explicit target_session over auto", async () => {
    const emit = await app.request("/api/handoffs/emit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source_session_id: "src-1",
        target_mode: "webcraft",
        target_session: "fixed-target-id",
        intent: "x",
      }),
    });
    const id = ((await emit.json()) as { handoff_id: string }).handoff_id;
    const res = await app.request(`/api/handoffs/${id}/confirm`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { target_session_id: string };
    expect(body.target_session_id).toBe("fixed-target-id");
    expect(launchedTargets[0].sessionId).toBe("fixed-target-id");
  });
});

describe("POST /api/handoffs/:id/cancel", () => {
  test("emits handoff-cancelled tag to source agent + clears card", async () => {
    const emit = await app.request("/api/handoffs/emit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source_session_id: "src-1", target_mode: "webcraft", intent: "x" }),
    });
    const id = ((await emit.json()) as { handoff_id: string }).handoff_id;

    const res = await app.request(`/api/handoffs/${id}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "want to refine first" }),
    });
    expect(res.status).toBe(200);

    // Cancel tag dispatched as synthetic user message
    expect(bridge.userMessages).toHaveLength(1);
    expect(bridge.userMessages[0].sessionId).toBe("src-1");
    expect(bridge.userMessages[0].content).toContain("<pneuma:handoff-cancelled");
    expect(bridge.userMessages[0].content).toContain('reason="want to refine first"');

    // Cancel WS broadcast for any other tabs viewing the proposal
    const cancelEvents = bridge.broadcasts.filter((b) => b.msg.type === "handoff_cancelled");
    expect(cancelEvents).toHaveLength(1);
  });

  test("omits reason attribute when empty", async () => {
    const emit = await app.request("/api/handoffs/emit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source_session_id: "src-1", target_mode: "webcraft", intent: "x" }),
    });
    const id = ((await emit.json()) as { handoff_id: string }).handoff_id;
    const res = await app.request(`/api/handoffs/${id}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    expect(bridge.userMessages[0].content).toBe("<pneuma:handoff-cancelled />");
  });

  test("escapes quotes in reason", async () => {
    const emit = await app.request("/api/handoffs/emit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source_session_id: "src-1", target_mode: "webcraft", intent: "x" }),
    });
    const id = ((await emit.json()) as { handoff_id: string }).handoff_id;
    const res = await app.request(`/api/handoffs/${id}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: 'has "quotes" and <tags>' }),
    });
    expect(res.status).toBe(200);
    expect(bridge.userMessages[0].content).toContain("&quot;quotes&quot;");
    expect(bridge.userMessages[0].content).toContain("&lt;tags&gt;");
  });

  test("404 unknown id", async () => {
    const res = await app.request("/api/handoffs/missing/cancel", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(404);
  });

  test("409 if already confirmed", async () => {
    const emit = await app.request("/api/handoffs/emit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source_session_id: "src-1", target_mode: "webcraft", intent: "x" }),
    });
    const id = ((await emit.json()) as { handoff_id: string }).handoff_id;
    await app.request(`/api/handoffs/${id}/confirm`, { method: "POST" });
    const cancel = await app.request(`/api/handoffs/${id}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(cancel.status).toBe(409);
  });
});
