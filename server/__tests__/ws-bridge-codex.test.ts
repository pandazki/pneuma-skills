import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WsBridge } from "../ws-bridge.js";
import type { CodexAdapter } from "../../backends/codex/codex-adapter.js";
import type { BrowserOutgoingMessage } from "../session-types.js";

/**
 * Minimal fake of `CodexAdapter` — just the surface `CodexBridge.attach`
 * + `CodexBridge.handleBrowserUserMessage` actually call. Avoids spinning
 * up the real adapter's stdio + JSON-RPC transport just to assert routing.
 */
function makeFakeCodexAdapter() {
  const sentMessages: BrowserOutgoingMessage[] = [];
  const steerCalls: Array<{ content: string; images?: { media_type: string; data: string }[] }> = [];
  let steerError: Error | null = null;
  const fake = {
    onBrowserMessage: (_cb: unknown) => {},
    onSessionMeta: (_cb: unknown) => {},
    onDisconnect: (_cb: unknown) => {},
    sendBrowserMessage: (msg: BrowserOutgoingMessage) => {
      sentMessages.push(msg);
      return true;
    },
    canSteer: () => true,
    steerUserMessage: async (content: string, images?: { media_type: string; data: string }[]) => {
      steerCalls.push({ content, images });
      if (steerError) throw steerError;
    },
    disconnect: async () => {},
  };
  return {
    adapter: fake as unknown as CodexAdapter,
    sentMessages,
    steerCalls,
    failSteer: (error: Error | null) => { steerError = error; },
  };
}

function attachRecordingBrowser(session: ReturnType<WsBridge["getOrCreateSession"]>) {
  const frames: Array<Record<string, unknown>> = [];
  session.browserSockets.add({
    send: (raw: string) => frames.push(JSON.parse(raw)),
  } as never);
  return frames;
}

describe("WsBridge Codex integration", () => {
  test("isCodexSession returns false by default", () => {
    const bridge = new WsBridge();
    expect(bridge.isCodexSession("unknown")).toBe(false);
  });

  test("getOrCreateSession with codex backend sets correct capabilities", () => {
    const bridge = new WsBridge();
    const session = bridge.getOrCreateSession("codex-1", "codex");

    expect(session.state.backend_type).toBe("codex");
    expect(session.state.agent_capabilities.streaming).toBe(true);
    expect(session.state.agent_capabilities.resume).toBe(true);
    expect(session.state.agent_capabilities.permissions).toBe(true);
    expect(session.state.agent_capabilities.modelSwitch).toBe(true);
    expect(session.state.agent_capabilities.toolProgress).toBe(false);
  });

  test("closeSession cleans up Codex adapter resources", () => {
    const bridge = new WsBridge();
    bridge.getOrCreateSession("session-cleanup", "codex");

    // Should not throw even without an adapter attached
    bridge.closeSession("session-cleanup");
    expect(bridge.getSession("session-cleanup")).toBeUndefined();
  });

  /**
   * End-to-end: a browser `user_message` carrying a file should land on
   * disk under `<workspace>/.pneuma/uploads/`, and the adapter should
   * receive content with the `<uploaded-files>` block inlined. Until
   * 3.13.x the codex bridge silently dropped `msg.files`; this locks in
   * the polymorphic prepare path that fixed it.
   */
  test("routes uploaded files through prepareIncomingUserMessage end-to-end", () => {
    const workspace = mkdtempSync(join(tmpdir(), "pneuma-codex-upload-"));
    try {
      const bridge = new WsBridge();
      bridge.setWorkspace(workspace);
      const { adapter, sentMessages } = makeFakeCodexAdapter();
      bridge.attachCodexAdapter("s1", adapter);

      const session = bridge.getSession("s1")!;
      const fileBody = "<html>hello codex</html>";
      const msg: BrowserOutgoingMessage = {
        type: "user_message",
        content: "what do you see?",
        files: [
          {
            name: "page.html",
            media_type: "text/html",
            data: Buffer.from(fileBody, "utf-8").toString("base64"),
            size: fileBody.length,
          },
        ],
      };
      (bridge as unknown as { routeBrowserMessage: (s: unknown, m: unknown) => void }).routeBrowserMessage(session, msg);

      // 1. File landed on disk.
      const uploadsDir = join(workspace, ".pneuma", "uploads");
      const saved = readdirSync(uploadsDir);
      expect(saved.length).toBe(1);
      expect(saved[0]).toMatch(/page\.html$/);

      // 2. Adapter received the enriched user_message with `<uploaded-files>`
      //    folded into `content` and no `images` field for this text-only case.
      expect(sentMessages.length).toBe(1);
      const sent = sentMessages[0] as { type: string; content: string; images?: unknown };
      expect(sent.type).toBe("user_message");
      expect(sent.content).toContain("<uploaded-files");
      expect(sent.content).toContain("page.html");
      expect(sent.content).toContain(fileBody); // inline body (under 32KB)
      expect(sent.content.endsWith("what do you see?")).toBe(true);
      expect(sent.images).toBeUndefined();
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  /**
   * Image branch: a small inline-eligible image should both land on disk
   * and reach the adapter in the `images` field so codex packs it as a
   * data URL.
   */
  test("inline-eligible images reach the adapter while staying on disk", () => {
    const workspace = mkdtempSync(join(tmpdir(), "pneuma-codex-image-"));
    try {
      const bridge = new WsBridge();
      bridge.setWorkspace(workspace);
      const { adapter, sentMessages } = makeFakeCodexAdapter();
      bridge.attachCodexAdapter("s2", adapter);

      const session = bridge.getSession("s2")!;
      const data = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");
      const msg: BrowserOutgoingMessage = {
        type: "user_message",
        content: "describe",
        images: [{ media_type: "image/png", data }],
      };
      (bridge as unknown as { routeBrowserMessage: (s: unknown, m: unknown) => void }).routeBrowserMessage(session, msg);

      const uploadsDir = join(workspace, ".pneuma", "uploads");
      expect(readdirSync(uploadsDir).length).toBe(1);

      expect(sentMessages.length).toBe(1);
      const sent = sentMessages[0] as { content: string; images?: { media_type: string; data: string }[] };
      expect(sent.images).toEqual([{ media_type: "image/png", data }]);
      // Notification still lists the image (small → no `large="true"`).
      expect(sent.content).toContain("<image path=");
      expect(sent.content).not.toContain('large="true"');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test("steers the active turn and acknowledges only after the native RPC succeeds", async () => {
    const bridge = new WsBridge();
    const { adapter, steerCalls } = makeFakeCodexAdapter();
    bridge.attachCodexAdapter("steer-ok", adapter);
    const session = bridge.getSession("steer-ok")!;
    session.cliIdle = false;
    const frames = attachRecordingBrowser(session);

    (bridge as unknown as { routeBrowserMessage: (s: unknown, m: unknown) => void })
      .routeBrowserMessage(session, {
        type: "steer_message",
        content: "focus on rollback",
        images: [{ media_type: "image/png", data: "aW1hZ2U=" }],
        client_msg_id: "queued-2",
      });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(steerCalls).toEqual([{
      content: "focus on rollback",
      images: [{ media_type: "image/png", data: "aW1hZ2U=" }],
    }]);
    expect(session.messageHistory.filter((message) => message.type === "user_message")).toHaveLength(1);
    expect(frames.find((frame) => frame.type === "steer_result")).toMatchObject({
      client_msg_id: "queued-2",
      success: true,
    });
  });

  test("failed native steer restores env context and does not commit chat history", async () => {
    const bridge = new WsBridge();
    const { adapter, failSteer } = makeFakeCodexAdapter();
    failSteer(new Error("active turn changed"));
    bridge.attachCodexAdapter("steer-fail", adapter);
    const session = bridge.getSession("steer-fail")!;
    session.cliIdle = false;
    session.pendingEnvContext.push("<pneuma:env reason=\"opened\" />");
    const frames = attachRecordingBrowser(session);

    (bridge as unknown as { routeBrowserMessage: (s: unknown, m: unknown) => void })
      .routeBrowserMessage(session, {
        type: "steer_message",
        content: "try this",
        client_msg_id: "queued-fail",
      });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(session.messageHistory.filter((message) => message.type === "user_message")).toHaveLength(0);
    expect(session.pendingEnvContext).toEqual(["<pneuma:env reason=\"opened\" />"]);
    expect(frames.find((frame) => frame.type === "steer_result")).toMatchObject({
      client_msg_id: "queued-fail",
      success: false,
      error: "active turn changed",
    });
  });

  test("a rejected steer can retry the same queued message id", async () => {
    const bridge = new WsBridge();
    const { adapter, failSteer, steerCalls } = makeFakeCodexAdapter();
    failSteer(new Error("active turn changed"));
    bridge.attachCodexAdapter("steer-retry", adapter);
    const session = bridge.getSession("steer-retry")!;
    session.cliIdle = false;
    const frames = attachRecordingBrowser(session);
    const msg = {
      type: "steer_message",
      content: "retry this guidance",
      client_msg_id: "queued-retry",
    } as const;
    const route = () => (bridge as unknown as {
      routeBrowserMessage: (s: unknown, m: unknown) => void;
    }).routeBrowserMessage(session, msg);

    route();
    await new Promise((resolve) => setTimeout(resolve, 0));
    failSteer(null);
    route();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(steerCalls).toHaveLength(2);
    expect(frames.filter((frame) => frame.type === "steer_result").map((frame) => frame.success))
      .toEqual([false, true]);
    expect(session.messageHistory.filter((message) => message.type === "user_message")).toHaveLength(1);
  });

  test("idle preflight rejects before the native RPC and leaves the id retryable", async () => {
    const bridge = new WsBridge();
    const { adapter, steerCalls } = makeFakeCodexAdapter();
    bridge.attachCodexAdapter("steer-idle", adapter);
    const session = bridge.getSession("steer-idle")!;
    const frames = attachRecordingBrowser(session);

    (bridge as unknown as { routeBrowserMessage: (s: unknown, m: unknown) => void })
      .routeBrowserMessage(session, {
        type: "steer_message",
        content: "too late",
        client_msg_id: "queued-codex-idle",
      });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(steerCalls).toHaveLength(0);
    expect(session.processedClientMessageIdSet.has("queued-codex-idle")).toBe(false);
    expect(frames.find((frame) => frame.type === "steer_result")).toMatchObject({
      client_msg_id: "queued-codex-idle",
      success: false,
    });
  });

  test("failed steer removes only the attachment files minted by that attempt", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "pneuma-codex-steer-rollback-"));
    try {
      const bridge = new WsBridge();
      bridge.setWorkspace(workspace);
      const { adapter, failSteer } = makeFakeCodexAdapter();
      failSteer(new Error("active turn changed"));
      bridge.attachCodexAdapter("steer-files-fail", adapter);
      const session = bridge.getSession("steer-files-fail")!;
      session.cliIdle = false;

      (bridge as unknown as { routeBrowserMessage: (s: unknown, m: unknown) => void })
        .routeBrowserMessage(session, {
          type: "steer_message",
          content: "inspect this",
          files: [{
            name: "retry.txt",
            media_type: "text/plain",
            data: Buffer.from("retry body").toString("base64"),
            size: 10,
          }],
          client_msg_id: "queued-files-fail",
        });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(readdirSync(join(workspace, ".pneuma", "uploads"))).toHaveLength(0);
      expect(session.messageHistory.filter((message) => message.type === "user_message")).toHaveLength(0);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
