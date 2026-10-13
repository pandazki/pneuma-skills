import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import type { AgentBackendType } from "../../core/types/agent-backend.js";
import {
  mountHandoffRoutes,
  pruneExpiredProposals,
  escapeXmlAttr,
  type HandoffWsBridgeLike,
  type HandoffProposal,
  type HandoffRoutesOptions,
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
let quickWs: string;
let app: Hono;
let bridge: ReturnType<typeof makeMockBridge>;
let stop: () => void;
let proposals: Map<string, HandoffProposal>;
let routeOptions: HandoffRoutesOptions;
let launchedTargets: Array<{
  mode: string;
  workspace: string;
  project?: string;
  sessionId?: string;
  backendType?: string;
}>;
let killedSources: string[];

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "pneuma-handoff-"));
  projRoot = join(home, "proj");
  quickWs = join(home, "quick-ws");
  await mkdir(join(quickWs, ".pneuma"), { recursive: true });
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

  routeOptions = {
    wsBridge: bridge,
    isBackendRegistered: (type): type is AgentBackendType => type === "codex" || type === "claude-code",
    killSession: async (sid) => { killedSources.push(sid); },
    launchSession: async (params) => {
      launchedTargets.push(params);
      return `http://localhost:17080?session=${params.sessionId ?? "mock"}&mode=${params.mode}`;
    },
    resolveSource: async (sid) => {
      if (sid === "src-1") {
        return {
          kind: "project" as const,
          projectRoot: projRoot,
          mode: "doc",
          displayName: "Source Doc",
        };
      }
      if (sid === "src-quick") {
        return {
          kind: "quick" as const,
          workspace: quickWs,
          backendType: "codex",
          mode: "doc",
          displayName: "Quick Doc",
        };
      }
      return null;
    },
    pruneIntervalMs: 60_000,
    pendingTtlMs: 60_000,
  };
  const ctx = mountHandoffRoutes(app, routeOptions);
  stop = ctx.stop;
  proposals = ctx.proposals;
});

afterEach(async () => {
  stop();
  await rm(home, { recursive: true, force: true });
});

async function post(path: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function requestHandoff(overrides: Record<string, unknown> = {}): Promise<string> {
  const result = await post("/api/handoffs/request", {
    source_session_id: "src-1",
    target_mode: "webcraft",
    intent: "Build the agreed website",
    target_backend: "codex",
    ...overrides,
  });
  expect(result.status).toBe(200);
  const body = await result.json() as { request_id: string; status: string };
  expect(body.status).toBe("preparing");
  return body.request_id;
}

function emitBrief(request_id?: string, overrides: Record<string, unknown> = {}): Promise<Response> {
  return post("/api/handoffs/emit", {
    source_session_id: "src-1",
    target_mode: "webcraft",
    intent: "Build the agreed website",
    ...(request_id === undefined ? {} : { request_id }),
    summary: "The source work is ready",
    ...overrides,
  });
}

async function expectNoLaunchEffects(): Promise<void> {
  expect(launchedTargets).toEqual([]);
  expect(killedSources).toEqual([]);
  expect(await readdir(join(projRoot, ".pneuma", "sessions"))).toEqual(["src-1"]);
  expect(await readFile(join(projRoot, ".pneuma", "sessions", "src-1", "history.json"), "utf-8")).toBe("[]");
  expect(existsSync(join(quickWs, ".pneuma", "inbound-handoff.json"))).toBe(false);
}

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

  test("preparing requests expire through the same timer helper", () => {
    const request: HandoffProposal = {
      handoff_id: "request", request_id: "request", source_session_id: "src",
      target_mode: "webcraft", target_backend: "codex", intent: "x",
      proposed_at: 1, state: "preparing",
    };
    const map = new Map([[request.handoff_id, request]]);
    expect(pruneExpiredProposals(map, 10, 5)).toEqual(["request"]);
    expect(request.state).toBe("timed_out");
    expect(pruneExpiredProposals(map, 20, 5)).toEqual([]);
  });
});

describe("POST /api/handoffs/request", () => {
  test("captures backend and escaped user intent before dispatch without publishing a review yet", async () => {
    const intent = 'Build "this" & <that>';
    const id = await requestHandoff({ intent });
    const proposal = proposals.get(id)!;
    expect(proposal.request_id).toBe(id);
    expect(proposal.state).toBe("preparing");
    expect(proposal.target_backend).toBe("codex");
    expect(proposal.target_session).toBe("auto");
    expect(proposal.intent).toBe(intent);
    expect(bridge.broadcasts).toEqual([]);
    expect(bridge.userMessages).toEqual([{
      sessionId: "src-1",
      content: `<pneuma:request-handoff request_id="${id}" target="webcraft" target_session="auto" intent="Build &quot;this&quot; &amp; &lt;that&gt;" />`,
    }]);
    await expectNoLaunchEffects();
  });

  test.each([undefined, null, "", "not-installed-in-the-registry", 42])("rejects invalid backend %p without effects", async (target_backend) => {
    const result = await post("/api/handoffs/request", {
      source_session_id: "src-1", target_mode: "webcraft", intent: "Build a site", target_backend,
    });
    expect(result.status).toBe(400);
    expect((await result.json() as { error: string }).error).toContain("target_backend");
    expect(proposals.size).toBe(0);
    expect(bridge.userMessages).toEqual([]);
    await expectNoLaunchEffects();
  });

  test.each(["nobody", "src-quick"])("requires a known project source, rejecting %s", async (source_session_id) => {
    const result = await post("/api/handoffs/request", {
      source_session_id, target_mode: "webcraft", intent: "Build a site", target_backend: "codex",
    });
    expect(result.status).toBe(400);
    expect(proposals.size).toBe(0);
    expect(bridge.userMessages).toEqual([]);
    await expectNoLaunchEffects();
  });

  test.each(["preparing", "pending"])("supersedes an earlier %s request and rejects its late reply", async (state) => {
    const first = await requestHandoff();
    if (state === "pending") expect((await emitBrief(first)).status).toBe(200);
    const second = await requestHandoff({ intent: "Revised brief", target_backend: "claude-code" });
    expect(proposals.get(first)?.state).toBe("cancelled");
    expect(proposals.get(second)?.state).toBe("preparing");
    expect((await emitBrief(first)).status).toBe(409);
    expect(proposals.get(second)?.target_backend).toBe("claude-code");
    expect(bridge.broadcasts.some(({ msg }) => msg.type === "handoff_cancelled" && msg.handoff_id === first)).toBe(true);
  });

  test("supersedes an earlier legacy proposal", async () => {
    const legacy = await emitBrief();
    const { handoff_id } = await legacy.json() as { handoff_id: string };
    const requestId = await requestHandoff();
    expect(proposals.get(handoff_id)?.state).toBe("cancelled");
    expect(proposals.get(requestId)?.state).toBe("preparing");
  });

  test("retains a cancelled request id when dispatch throws", async () => {
    bridge.sendUserMessage = () => { throw new Error("dispatch unavailable"); };
    const result = await post("/api/handoffs/request", {
      source_session_id: "src-1", target_mode: "webcraft", intent: "Build a site", target_backend: "codex",
    });
    expect(result.status).toBe(500);
    const { request_id } = await result.json() as { request_id: string };
    expect(proposals.get(request_id)?.state).toBe("cancelled");
    expect((await emitBrief(request_id)).status).toBe(409);
    await expectNoLaunchEffects();
  });
});

describe("correlated handoff lifecycle", () => {
  test.each(["preparing", "pending"])("requires the request id while the user request is %s", async (state) => {
    const id = await requestHandoff();
    if (state === "pending") expect((await emitBrief(id)).status).toBe(200);
    const uncorrelated = await emitBrief();
    expect(uncorrelated.status).toBe(400);
    const { error } = await uncorrelated.json() as { error: string };
    expect(error).toContain("request_id");
    expect(error).toContain(id);
    expect(proposals.size).toBe(1);
    expect(proposals.get(id)?.state).toBe(state);
  });

  test("an unknown request id never falls back to the legacy flow", async () => {
    expect((await emitBrief("unknown")).status).toBe(400);
    expect(proposals.size).toBe(0);
    expect(bridge.broadcasts).toEqual([]);
  });

  test.each([
    { source_session_id: "another-source" },
    { target_mode: "slide" },
    { target_session: "existing-session" },
    { target_session: null },
  ])("refuses a mismatched correlated emit: %p", async (overrides) => {
    const id = await requestHandoff();
    const result = await emitBrief(id, overrides);
    expect(result.status).toBe(400);
    expect(proposals.get(id)?.state).toBe("preparing");
    expect(bridge.broadcasts).toEqual([]);
  });

  test("a direct agent payload cannot replace user backend or original intent", async () => {
    const id = await requestHandoff();
    const result = await emitBrief(id, {
      target_backend: "claude-code", intent: "Changed by the agent", summary: "Useful brief",
    });
    expect(result.status).toBe(200);
    expect(proposals.get(id)?.target_backend).toBe("codex");
    expect(proposals.get(id)?.intent).toBe("Build the agreed website");
    expect(proposals.get(id)?.target_session).toBe("auto");
    expect(proposals.get(id)?.summary).toBe("Useful brief");
    expect((await app.request(`/api/handoffs/${id}/confirm`, { method: "POST" })).status).toBe(200);
    expect(launchedTargets[0]?.backendType).toBe("codex");
  });

  test("duplicate correlated emits cannot replace the brief under review", async () => {
    const id = await requestHandoff();
    expect((await emitBrief(id, { summary: "First brief" })).status).toBe(200);
    expect((await emitBrief(id, { summary: "Second brief" })).status).toBe(409);
    expect(proposals.get(id)?.summary).toBe("First brief");
    expect(bridge.broadcasts.filter(({ msg }) => msg.type === "handoff_proposed")).toHaveLength(1);
  });

  test("confirmation refuses a request before the brief is ready", async () => {
    const id = await requestHandoff();
    expect((await app.request(`/api/handoffs/${id}/confirm`, { method: "POST" })).status).toBe(409);
    expect(proposals.get(id)?.state).toBe("preparing");
    await expectNoLaunchEffects();
  });

  test("revalidates the captured backend before writing files or killing the source", async () => {
    const id = await requestHandoff();
    expect((await emitBrief(id)).status).toBe(200);
    routeOptions.isBackendRegistered = (backend): backend is AgentBackendType => backend === "claude-code";
    const result = await app.request(`/api/handoffs/${id}/confirm`, { method: "POST" });
    expect(result.status).toBe(400);
    expect(proposals.get(id)?.state).toBe("pending");
    await expectNoLaunchEffects();
  });

  test("cancelling a preparing request blocks late agent replies", async () => {
    const id = await requestHandoff();
    expect((await post(`/api/handoffs/${id}/cancel`, {})).status).toBe(200);
    expect(proposals.get(id)?.state).toBe("cancelled");
    expect((await emitBrief(id)).status).toBe(409);
    expect((await app.request(`/api/handoffs/${id}/confirm`, { method: "POST" })).status).toBe(409);
    await expectNoLaunchEffects();
  });

  test.each(["preparing", "pending"])("expires a %s request on route access before the timer runs", async (state) => {
    const id = await requestHandoff();
    if (state === "pending") expect((await emitBrief(id)).status).toBe(200);
    proposals.get(id)!.proposed_at = Date.now() - 60_001;
    const result = state === "preparing"
      ? await emitBrief(id)
      : await app.request(`/api/handoffs/${id}/confirm`, { method: "POST" });
    expect(result.status).toBe(409);
    expect(proposals.get(id)?.state).toBe("timed_out");
    expect((await emitBrief(id)).status).toBe(409);
    await expectNoLaunchEffects();
  });

  test("a legacy emit paused in source lookup cannot supersede a newer UI request", async () => {
    const lookupEntered = Promise.withResolvers<void>();
    const releaseLookup = Promise.withResolvers<void>();
    const resolveSource = routeOptions.resolveSource!;
    let firstLookup = true;
    routeOptions.resolveSource = async (sourceId) => {
      if (firstLookup) {
        firstLookup = false;
        lookupEntered.resolve();
        await releaseLookup.promise;
      }
      return resolveSource(sourceId);
    };
    const legacy = emitBrief();
    await lookupEntered.promise;
    const id = await requestHandoff();
    releaseLookup.resolve();
    const result = await legacy;
    expect(result.status).toBe(400);
    expect((await result.json() as { error: string }).error).toContain(id);
    expect(proposals.size).toBe(1);
    expect(proposals.get(id)?.state).toBe("preparing");
  });

  test("concurrent confirms launch only once across asynchronous work", async () => {
    const id = await requestHandoff();
    expect((await emitBrief(id)).status).toBe(200);
    const launchEntered = Promise.withResolvers<void>();
    const releaseLaunch = Promise.withResolvers<void>();
    const launchSession = routeOptions.launchSession!;
    routeOptions.launchSession = async (params) => {
      const url = await launchSession(params);
      launchEntered.resolve();
      await releaseLaunch.promise;
      return url;
    };
    const first = app.request(`/api/handoffs/${id}/confirm`, { method: "POST" });
    await launchEntered.promise;
    const duplicate = await app.request(`/api/handoffs/${id}/confirm`, { method: "POST" });
    expect(duplicate.status).toBe(409);
    releaseLaunch.resolve();
    expect((await first).status).toBe(200);
    expect(launchedTargets).toHaveLength(1);
    expect(killedSources).toEqual(["src-1"]);
    expect((await emitBrief(id)).status).toBe(409);
  });

  test("a cancel waiting on its body cannot reopen an already confirmed proposal", async () => {
    const id = await requestHandoff();
    expect((await emitBrief(id)).status).toBe(200);
    const readingBody = Promise.withResolvers<void>();
    let completeBody: () => void = () => {};
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        readingBody.resolve();
        completeBody = () => {
          controller.enqueue(new TextEncoder().encode("{}"));
          controller.close();
        };
      },
    }, { highWaterMark: 0 });
    const cancel = app.request(`/api/handoffs/${id}/cancel`, {
      method: "POST", headers: { "content-type": "application/json" }, body,
    });
    await readingBody.promise;
    const confirmed = await app.request(`/api/handoffs/${id}/confirm`, { method: "POST" });
    expect(confirmed.status).toBe(200);
    completeBody();
    expect((await cancel).status).toBe(409);
    expect(proposals.get(id)?.state).toBe("confirmed");
    expect(launchedTargets).toHaveLength(1);
    expect(bridge.userMessages).toHaveLength(1);
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
    expect((bridge.broadcasts[0].msg as unknown as { handoff_id: string }).handoff_id).toBe(body.handoff_id);
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
      workspace: projRoot,
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

  /**
   * A quick source hands its workspace to a new quick session. No project is
   * created, nothing is migrated, and the two sessions are related by nothing
   * the server writes — sessions that need to be related are what a project
   * is for. What the target gets is a brief and a launch.
   */
  test("a quick source hands the workspace to a new quick session", async () => {
    const emit = await app.request("/api/handoffs/emit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source_session_id: "src-quick",
        target_mode: "webcraft",
        target_backend: "claude-code",
        intent: "turn these notes into a page",
        suggested_files: ["notes.md"],
      }),
    });
    const id = ((await emit.json()) as { handoff_id: string }).handoff_id;

    const res = await app.request(`/api/handoffs/${id}/confirm`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { confirmed: boolean; target_session_id?: string };
    expect(body.confirmed).toBe(true);
    // No id to report: a quick session mints its own at boot.
    expect(body.target_session_id).toBeUndefined();

    // Staged where a quick session's agent actually looks — the workspace's
    // own `.pneuma/`, not one nesting deeper.
    const inboundPath = join(quickWs, ".pneuma", "inbound-handoff.json");
    expect(existsSync(inboundPath)).toBe(true);
    const inbound = JSON.parse(await readFile(inboundPath, "utf-8")) as {
      intent: string;
      source_session_id: string;
      suggested_files: string[];
    };
    expect(inbound.intent).toBe("turn these notes into a page");
    expect(inbound.source_session_id).toBe("src-quick");
    expect(inbound.suggested_files).toEqual(["notes.md"]);

    // A workspace launch: no project, no pre-minted id, and the source's
    // backend carried over because a workspace's backend is fixed.
    expect(launchedTargets).toHaveLength(1);
    expect(launchedTargets[0]!.workspace).toBe(quickWs);
    expect(launchedTargets[0]!.project).toBeUndefined();
    expect(launchedTargets[0]!.sessionId).toBeUndefined();
    expect(launchedTargets[0]!.backendType).toBe("codex");

    expect(killedSources).toEqual(["src-quick"]);
  });

  test("refuses when the source session cannot be resolved", async () => {
    const emit = await app.request("/api/handoffs/emit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source_session_id: "nobody", target_mode: "webcraft", intent: "x" }),
    });
    const id = ((await emit.json()) as { handoff_id: string }).handoff_id;
    const res = await app.request(`/api/handoffs/${id}/confirm`, { method: "POST" });
    expect(res.status).toBe(500);
    expect(launchedTargets).toHaveLength(0);
    // Left pending so the user can try again rather than losing the card.
    const retry = await app.request(`/api/handoffs/${id}/confirm`, { method: "POST" });
    expect(retry.status).toBe(500);
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
    const targetState = join(projRoot, ".pneuma", "sessions", "fixed-target-id", "session.json");
    await mkdir(join(projRoot, ".pneuma", "sessions", "fixed-target-id"), { recursive: true });
    await writeFile(targetState, JSON.stringify({ backendType: "codex", mode: "webcraft" }));
    const emit = await app.request("/api/handoffs/emit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source_session_id: "src-1",
        target_mode: "webcraft",
        target_session: "fixed-target-id",
        target_backend: "claude-code",
        intent: "x",
      }),
    });
    const id = ((await emit.json()) as { handoff_id: string }).handoff_id;
    const res = await app.request(`/api/handoffs/${id}/confirm`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { target_session_id: string };
    expect(body.target_session_id).toBe("fixed-target-id");
    expect(launchedTargets[0].sessionId).toBe("fixed-target-id");
    // Omitting a backend preserves launchPneumaChild's existing-session
    // resolution; an uncorrelated agent cannot override the persisted lock.
    expect(launchedTargets[0].backendType).toBeUndefined();
    expect(JSON.parse(await readFile(targetState, "utf-8")).backendType).toBe("codex");
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
