import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import type { AgentBackendType } from "../types/agent-backend.js";
import type { HandoffProposalPayload, HandoffRequestInput } from "../types/handoff.js";
import { runHandoffCommand } from "../../bin/handoff-cli.js";
import { mountHandoffRoutes } from "../../server/handoff-routes.js";

test("a project user's Codex selection survives request, agent CLI, review and launch", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "pneuma-handoff-contract-"));
  const sourceState = join(projectRoot, ".pneuma", "sessions", "source", "session.json");
  await mkdir(join(projectRoot, ".pneuma", "sessions", "source"), { recursive: true });
  await writeFile(sourceState, JSON.stringify({ mode: "doc", backendType: "claude-code" }));
  const app = new Hono();
  const requests: string[] = [];
  const reviews: HandoffProposalPayload[] = [];
  const launches: Array<{ backendType?: string; sessionId?: string }> = [];
  const request: HandoffRequestInput = {
    source_session_id: "source",
    target_mode: "webcraft",
    intent: "Build the agreed website",
    target_backend: "codex",
  };
  const context = mountHandoffRoutes(app, {
    wsBridge: {
      sendUserMessage: (_id, message) => { requests.push(message); },
      broadcastToSession: (_id, message) => {
        if (message.type === "handoff_proposed") reviews.push(message.payload as HandoffProposalPayload);
      },
    },
    isBackendRegistered: (backend: string): backend is AgentBackendType =>
      backend === "codex" || backend === "claude-code",
    resolveSource: async () => {
      const source = JSON.parse(await readFile(sourceState, "utf-8"));
      expect(source.backendType).toBe("claude-code");
      return { kind: "project", projectRoot, mode: source.mode };
    },
    launchSession: async (params) => {
      const inbound = JSON.parse(await readFile(join(
        projectRoot, ".pneuma", "sessions", params.sessionId!, ".pneuma", "inbound-handoff.json",
      ), "utf-8"));
      expect(inbound.intent).toBe(request.intent);
      expect(inbound.summary).toBe("Brand and copy are ready");
      expect(inbound.suggested_files).toEqual(["brief.md"]);
      launches.push(params);
      return "http://localhost:17008";
    },
  });

  try {
    const prepared = await app.request("/api/handoffs/request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    expect(prepared.status).toBe(200);
    const { request_id, status } = await prepared.json() as { request_id: string; status: string };
    expect(status).toBe("preparing");
    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain(`request_id="${request_id}"`);
    expect(requests[0]).toContain('target_session="auto"');

    const errors: string[] = [];
    const result = await runHandoffCommand(["--json", JSON.stringify({
      request_id,
      target_mode: request.target_mode,
      target_session: "auto",
      intent: "The agent cannot replace the original user intent",
      target_backend: "claude-code",
      summary: "Brand and copy are ready",
      suggested_files: ["brief.md"],
      key_decisions: ["Use the approved brand"],
      open_questions: ["Confirm the launch date"],
    })], {
      PNEUMA_SESSION_ID: "source",
      PNEUMA_SERVER_URL: "http://localhost:17007",
    }, {
      stdout: () => {},
      stderr: (line) => { errors.push(line); },
      readStdin: async () => "",
      fetch: async (url, init) => app.request(new URL(url).pathname, init),
    });
    expect(errors).toEqual([]);
    expect(result).toBe(0);
    expect(context.proposals.size).toBe(1);
    expect(reviews).toHaveLength(1);
    expect(reviews[0]?.target_backend).toBe("codex");
    expect(reviews[0]?.intent).toBe(request.intent);
    expect(reviews[0]?.target_session).toBe("auto");
    expect(reviews[0]?.key_decisions).toEqual(["Use the approved brand"]);
    expect(reviews[0]?.open_questions).toEqual(["Confirm the launch date"]);

    const confirmed = await app.request(`/api/handoffs/${request_id}/confirm`, { method: "POST" });
    expect(confirmed.status).toBe(200);
    expect(launches).toHaveLength(1);
    expect(launches[0]?.backendType).toBe("codex");
    expect(launches[0]?.sessionId).toBeTruthy();
  } finally {
    context.stop();
    await rm(projectRoot, { recursive: true, force: true });
  }
});
