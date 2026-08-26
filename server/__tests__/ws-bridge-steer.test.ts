import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WsBridge } from "../ws-bridge.js";

function attachRecordingBrowser(session: ReturnType<WsBridge["getOrCreateSession"]>) {
  const frames: Array<Record<string, unknown>> = [];
  session.browserSockets.add({
    send: (raw: string) => frames.push(JSON.parse(raw)),
  } as never);
  return frames;
}

function routeSteer(bridge: WsBridge, session: unknown, content: string, id: string): void {
  (bridge as unknown as { routeBrowserMessage: (s: unknown, m: unknown) => void })
    .routeBrowserMessage(session, {
      type: "steer_message",
      content,
      client_msg_id: id,
    });
}

describe("WsBridge Claude steer-in", () => {
  test("writes a native stream-json user frame during an active turn", () => {
    const bridge = new WsBridge();
    const session = bridge.getOrCreateSession("claude-steer", "claude-code");
    const sent: string[] = [];
    bridge.attachCLITransport("claude-steer", {
      send: (line) => sent.push(line),
      close: () => {},
    });
    session.cliIdle = false;
    const frames = attachRecordingBrowser(session);

    routeSteer(bridge, session, "focus on the edge case", "queued-1");

    const cliFrames = sent.map((line) => JSON.parse(line));
    const userFrames = cliFrames.filter((frame) => frame.type === "user");
    expect(userFrames).toHaveLength(1);
    expect(userFrames[0].message.content).toBe("focus on the edge case");
    expect(cliFrames.some((frame) => frame.type === "control_request" && frame.request?.subtype === "interrupt")).toBe(false);
    expect(session.messageHistory.filter((message) => message.type === "user_message")).toHaveLength(1);
    expect(frames.find((frame) => frame.type === "steer_result")).toMatchObject({
      client_msg_id: "queued-1",
      success: true,
    });
  });

  test("deduplicates a repeated successful steer id", () => {
    const bridge = new WsBridge();
    const session = bridge.getOrCreateSession("claude-steer-duplicate", "claude-code");
    const sent: string[] = [];
    bridge.attachCLITransport("claude-steer-duplicate", {
      send: (line) => sent.push(line),
      close: () => {},
    });
    session.cliIdle = false;
    const frames = attachRecordingBrowser(session);

    routeSteer(bridge, session, "only once", "queued-duplicate");
    routeSteer(bridge, session, "only once", "queued-duplicate");

    expect(sent.map((line) => JSON.parse(line)).filter((frame) => frame.type === "user")).toHaveLength(1);
    expect(session.messageHistory.filter((message) => message.type === "user_message")).toHaveLength(1);
    expect(frames.filter((frame) => frame.type === "steer_result")).toHaveLength(1);
  });

  test("rejects steer while idle without consuming the queued message into history", () => {
    const bridge = new WsBridge();
    const session = bridge.getOrCreateSession("claude-idle", "claude-code");
    const sent: string[] = [];
    bridge.attachCLITransport("claude-idle", {
      send: (line) => sent.push(line),
      close: () => {},
    });
    const frames = attachRecordingBrowser(session);

    routeSteer(bridge, session, "too late", "queued-idle");

    expect(sent.map((line) => JSON.parse(line)).filter((frame) => frame.type === "user")).toHaveLength(0);
    expect(session.messageHistory.filter((message) => message.type === "user_message")).toHaveLength(0);
    expect(frames.find((frame) => frame.type === "steer_result")).toMatchObject({
      client_msg_id: "queued-idle",
      success: false,
    });
    expect(session.processedClientMessageIdSet.has("queued-idle")).toBe(false);
  });

  test("rolls back env context and releases retry id when the CLI write throws", () => {
    const bridge = new WsBridge();
    const session = bridge.getOrCreateSession("claude-write-fail", "claude-code");
    bridge.attachCLITransport("claude-write-fail", {
      send: (line) => {
        if (JSON.parse(line).type === "user") throw new Error("socket closed");
      },
      close: () => {},
    });
    session.cliIdle = false;
    session.pendingEnvContext.push("<pneuma:env reason=\"opened\" />");
    const frames = attachRecordingBrowser(session);

    routeSteer(bridge, session, "retry me", "queued-write-fail");

    expect(session.pendingEnvContext).toEqual(["<pneuma:env reason=\"opened\" />"]);
    expect(session.messageHistory.filter((message) => message.type === "user_message")).toHaveLength(0);
    expect(session.processedClientMessageIdSet.has("queued-write-fail")).toBe(false);
    expect(frames.find((frame) => frame.type === "steer_result")).toMatchObject({
      client_msg_id: "queued-write-fail",
      success: false,
      error: "socket closed",
    });
  });

  test("preserves image and file payloads through the shared steer ingest path", () => {
    const workspace = mkdtempSync(join(tmpdir(), "pneuma-claude-steer-"));
    try {
      const bridge = new WsBridge();
      bridge.setWorkspace(workspace);
      const session = bridge.getOrCreateSession("claude-steer-files", "claude-code");
      const sent: string[] = [];
      bridge.attachCLITransport("claude-steer-files", {
        send: (line) => sent.push(line),
        close: () => {},
      });
      session.cliIdle = false;

      (bridge as unknown as { routeBrowserMessage: (s: unknown, m: unknown) => void })
        .routeBrowserMessage(session, {
          type: "steer_message",
          content: "inspect both",
          images: [{ media_type: "image/png", data: "aW1hZ2U=" }],
          files: [{
            name: "notes.txt",
            media_type: "text/plain",
            data: Buffer.from("file body").toString("base64"),
            size: 9,
          }],
          client_msg_id: "queued-files",
        });

      const user = sent.map((line) => JSON.parse(line)).find((frame) => frame.type === "user");
      expect(user.message.content[0]).toMatchObject({ type: "image" });
      expect(user.message.content[1].text).toContain("<uploaded-files");
      expect(user.message.content[1].text).toContain("notes.txt");
      const history = session.messageHistory.find((message) => message.type === "user_message") as {
        images?: unknown[];
        files?: unknown[];
      };
      expect(history.images).toHaveLength(1);
      expect(history.files).toHaveLength(1);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
