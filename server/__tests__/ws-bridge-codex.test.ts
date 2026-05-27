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
  const fake = {
    onBrowserMessage: (_cb: unknown) => {},
    onSessionMeta: (_cb: unknown) => {},
    onDisconnect: (_cb: unknown) => {},
    sendBrowserMessage: (msg: BrowserOutgoingMessage) => {
      sentMessages.push(msg);
      return true;
    },
    disconnect: async () => {},
  };
  return { adapter: fake as unknown as CodexAdapter, sentMessages };
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
});
