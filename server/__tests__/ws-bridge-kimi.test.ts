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
import { Readable, Writable } from "node:stream";
import { WsBridge } from "../ws-bridge.js";
import { KimiAdapter } from "../../backends/kimi-cli/kimi-adapter.js";

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
});
