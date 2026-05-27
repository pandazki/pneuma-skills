/**
 * Integration test for WsBridge ↔ KimiAdapter wiring. We instantiate a real
 * KimiAdapter on top of mock streams (no actual kimi subprocess) and verify
 * the bridge:
 *   - tracks the session as kimi
 *   - routes browser-bound user messages to the adapter's stdin
 *   - exposes the kimi session via getActiveSessionId
 *   - cleans up on closeSession
 */

import { describe, expect, it } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { WsBridge } from "../ws-bridge.js";
import { KimiAdapter } from "../../backends/kimi-cli/kimi-adapter.js";
import type { BrowserOutgoingMessage } from "../session-types.js";

function makeAdapter(sessionId = "s1") {
  const stdoutFake = new Readable({ read() {} });
  const stderrFake = new Readable({ read() {} });
  const stdinWrites: string[] = [];
  const stdinFake = new Writable({
    write(chunk, _enc, cb) {
      stdinWrites.push(chunk.toString("utf-8"));
      cb();
    },
  });

  const adapter = new KimiAdapter({
    sessionId,
    stdin: stdinFake,
    stdout: stdoutFake,
    stderr: stderrFake,
    killProcess: async () => {},
  });

  return { adapter, stdinWrites, stdoutFake, stderrFake };
}

describe("WsBridge.attachKimiAdapter", () => {
  it("registers the session as kimi and reflects it in getActiveSessionId", () => {
    const bridge = new WsBridge();
    const { adapter } = makeAdapter("s1");

    bridge.attachKimiAdapter("s1", adapter);

    expect(bridge.isKimiSession("s1")).toBe(true);
    expect(bridge.isKimiSession("other")).toBe(false);
    expect(bridge.getActiveSessionId()).toBe("s1");

    const session = bridge.getSession("s1");
    expect(session?.state.backend_type).toBe("kimi-cli");
  });

  it("routes injectGreeting through the adapter's stdin", () => {
    const bridge = new WsBridge();
    const { adapter, stdinWrites } = makeAdapter("s1");
    bridge.attachKimiAdapter("s1", adapter);

    bridge.injectGreeting("s1", "hello kimi");

    expect(stdinWrites.length).toBeGreaterThan(0);
    expect(stdinWrites.some((w) => w.includes("hello kimi"))).toBe(true);
    // The encoded line should be a kimi-shape user message, not Pneuma NDJSON.
    const parsed = JSON.parse(stdinWrites[stdinWrites.length - 1].trim());
    expect(parsed.role).toBe("user");
    expect(parsed.content).toBe("hello kimi");
  });

  it("flushes pendingMessages onto the adapter when attached after queueing", () => {
    const bridge = new WsBridge();
    // Pre-create the session and queue a message before the adapter exists.
    const session = bridge.getOrCreateSession("s1", "kimi-cli");
    session.pendingMessages.push(
      JSON.stringify({
        type: "user",
        message: { role: "user", content: "queued msg" },
        parent_tool_use_id: null,
        session_id: "",
      }),
    );

    const { adapter, stdinWrites } = makeAdapter("s1");
    bridge.attachKimiAdapter("s1", adapter);

    expect(session.pendingMessages.length).toBe(0);
    expect(stdinWrites.some((w) => w.includes("queued msg"))).toBe(true);
  });

  it("closeSession disconnects the adapter and removes it from the map", () => {
    const bridge = new WsBridge();
    const { adapter } = makeAdapter("s1");
    bridge.attachKimiAdapter("s1", adapter);

    bridge.closeSession("s1");

    expect(bridge.isKimiSession("s1")).toBe(false);
    expect(bridge.getSession("s1")).toBeUndefined();
  });

  /**
   * End-to-end: a browser `user_message` carrying a file attachment should
   * (1) land on disk under `<workspace>/.pneuma/uploads/`, and (2) reach
   * the adapter's stdin with an `<uploaded-files>` block referencing that
   * path. Until 3.13.x kimi+codex bridges silently dropped `msg.files`;
   * this test exercises the polymorphic prepare path that fixed it.
   */
  it("routes uploaded files through prepareIncomingUserMessage end-to-end", () => {
    const workspace = mkdtempSync(join(tmpdir(), "pneuma-kimi-upload-"));
    try {
      const bridge = new WsBridge();
      bridge.setWorkspace(workspace);
      const { adapter, stdinWrites } = makeAdapter("s1");
      bridge.attachKimiAdapter("s1", adapter);

      const session = bridge.getSession("s1")!;
      const fileBody = "<html>hello</html>";
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
      // routeBrowserMessage is the entry from `handleBrowserMessage`; we
      // skip the WebSocket plumbing and call it directly.
      (bridge as unknown as { routeBrowserMessage: (s: unknown, m: unknown) => void }).routeBrowserMessage(session, msg);

      // 1. File landed on disk.
      const uploadsDir = join(workspace, ".pneuma", "uploads");
      const saved = readdirSync(uploadsDir);
      expect(saved.length).toBe(1);
      expect(saved[0]).toMatch(/page\.html$/);
      expect(readFileSync(join(uploadsDir, saved[0]), "utf-8")).toBe(fileBody);

      // 2. Stdin received the enriched content (kimi adapter wraps it in
      //    its own JSON envelope; the user content is one of the fields).
      const lastWrite = stdinWrites[stdinWrites.length - 1];
      expect(lastWrite).toContain("<uploaded-files");
      expect(lastWrite).toContain("page.html");
      expect(lastWrite).toContain("what do you see?");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
