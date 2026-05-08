import { describe, expect, it } from "bun:test";
import { Readable, Writable } from "node:stream";
import { KimiAdapter } from "../kimi-adapter.js";

function makeAdapter() {
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  const stdinWrites: string[] = [];

  const stdout = new Readable({ read() {} });
  const stderr = new Readable({ read() {} });
  const stdin = new Writable({
    write(chunk, _enc, cb) {
      stdinWrites.push(chunk.toString("utf-8"));
      cb();
    },
  });

  const adapter = new KimiAdapter({
    sessionId: "test-session",
    stdin: stdin as any,
    stdout: stdout as any,
    stderr: stderr as any,
    killProcess: async () => {},
  });

  return { adapter, stdout, stderr, stdin, stdinWrites };
}

describe("KimiAdapter", () => {
  it("emits onMessage for each parsed kimi NDJSON line", async () => {
    const { adapter, stdout } = makeAdapter();
    const received: any[] = [];
    adapter.onMessage((m) => received.push(m));
    stdout.push('{"role":"assistant","content":"hello"}\n');
    await new Promise((r) => setImmediate(r));
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({
      type: "assistant",
      content: [{ type: "text", text: "hello" }],
    });
  });

  it("buffers a partial NDJSON line until newline arrives", async () => {
    const { adapter, stdout } = makeAdapter();
    const received: any[] = [];
    adapter.onMessage((m) => received.push(m));
    stdout.push('{"role":"assistant",');
    await new Promise((r) => setImmediate(r));
    expect(received).toHaveLength(0);
    stdout.push('"content":"ok"}\n');
    await new Promise((r) => setImmediate(r));
    expect(received).toHaveLength(1);
  });

  it("captures kimi session ID from stderr", async () => {
    const { adapter, stderr } = makeAdapter();
    let captured: string | undefined;
    adapter.onSessionId((sid) => { captured = sid; });
    stderr.push("\nTo resume this session: kimi -r abcd1234-e5f6-7890-abcd-1234567890ab\n");
    await new Promise((r) => setImmediate(r));
    expect(captured).toBe("abcd1234-e5f6-7890-abcd-1234567890ab");
  });

  it("sendUserMessage writes a single NDJSON line to stdin", () => {
    const { adapter, stdinWrites } = makeAdapter();
    adapter.sendUserMessage("hi there");
    expect(stdinWrites).toEqual([
      JSON.stringify({ role: "user", content: "hi there" }) + "\n",
    ]);
  });

  it("seedSessionId fires onSessionId synchronously and dedups", () => {
    const { adapter } = makeAdapter();
    const fires: string[] = [];
    adapter.onSessionId((sid) => fires.push(sid));
    adapter.seedSessionId("seed-1234");
    adapter.seedSessionId("seed-1234"); // dedup — should not fire twice
    expect(fires).toEqual(["seed-1234"]);
  });

  it("seedSessionId can be overridden by a later regex match", async () => {
    const { adapter, stderr } = makeAdapter();
    const fires: string[] = [];
    adapter.onSessionId((sid) => fires.push(sid));
    adapter.seedSessionId("seed-aaaa");
    stderr.push("\nTo resume this session: kimi -r 11111111-2222-3333-4444-555555555555\n");
    await new Promise((r) => setImmediate(r));
    expect(fires).toEqual(["seed-aaaa", "11111111-2222-3333-4444-555555555555"]);
  });
});
