/**
 * AcpSessionTranslator tests. Every fixture below is lifted from frames
 * captured live against `kimi acp` (Kimi Code CLI 0.26.0) — including the
 * partial-JSON tool-argument streaming trap, the mutating `title`, and the
 * failed-tool and `session/load` replay shapes.
 */

import { describe, expect, it } from "bun:test";
import {
  AcpSessionTranslator,
  parseModelConfig,
  type AcpTranslationEvent,
  type PneumaMessage,
} from "../protocol.js";

function messages(events: AcpTranslationEvent[]): PneumaMessage[] {
  return events.filter((e) => e.kind === "message").map((e) => e.message);
}

describe("AcpSessionTranslator — text & thinking chunks", () => {
  it("accumulates agent_message_chunk tokens and flushes one text message at turn end", () => {
    const t = new AcpSessionTranslator();
    const deltas: string[] = [];
    for (const tok of ["Got", " it", " —", " the", " magic", " word", " is", " \"", "pap", "rika", "\"."]) {
      const evs = t.translate({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: tok } });
      for (const e of evs) {
        expect(e.kind).toBe("delta");
        if (e.kind === "delta") {
          expect(e.deltaType).toBe("text");
          deltas.push(e.text);
        }
      }
    }
    expect(deltas.join("")).toBe('Got it — the magic word is "paprika".');

    const flushed = messages(t.endTurn());
    expect(flushed).toEqual([
      { type: "assistant", content: [{ type: "text", text: 'Got it — the magic word is "paprika".' }] },
    ]);
    // Second endTurn flushes nothing.
    expect(t.endTurn()).toEqual([]);
  });

  it("emits thinking deltas for agent_thought_chunk and flushes a thinking block on kind switch", () => {
    const t = new AcpSessionTranslator();
    t.translate({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "The user " } });
    t.translate({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "is testing me." } });

    // Switching to a message chunk flushes the buffered thinking first.
    const evs = t.translate({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "OK" } });
    expect(messages(evs)).toEqual([
      { type: "assistant", content: [{ type: "thinking", thinking: "The user is testing me." }] },
    ]);
    expect(evs.at(-1)).toEqual({ kind: "delta", deltaType: "text", text: "OK" });

    expect(messages(t.endTurn())).toEqual([
      { type: "assistant", content: [{ type: "text", text: "OK" }] },
    ]);
  });

  it("drops whitespace-only buffers instead of emitting empty messages", () => {
    const t = new AcpSessionTranslator();
    t.translate({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "  \n" } });
    expect(t.endTurn()).toEqual([]);
  });
});

describe("AcpSessionTranslator — tool call lifecycle (captured Write flow)", () => {
  const TOOL_ID = "0:tool_lDiSJtoNyqb7LlVtKrz4QJMc";

  function startWrite(t: AcpSessionTranslator): AcpTranslationEvent[] {
    return t.translate({
      sessionUpdate: "tool_call",
      toolCallId: TOOL_ID,
      title: "Write",
      kind: "edit",
      status: "pending",
      content: [{ type: "content", content: { type: "text", text: "" } }],
    });
  }

  it("captures the tool name from the start frame and never parses streamed partial JSON", () => {
    const t = new AcpSessionTranslator();
    startWrite(t);

    // Streaming partial-JSON argument frames (real capture: status stays
    // in_progress, content.text grows, NO rawInput). Must yield progress
    // events only — never a tool_use with a half-parsed input.
    for (const partial of ['{"pa', '{"path":"out', '{"path":"out.txt","content":"pap']) {
      const evs = t.translate({
        sessionUpdate: "tool_call_update",
        toolCallId: TOOL_ID,
        status: "in_progress",
        content: [{ type: "content", content: { type: "text", text: partial } }],
      });
      expect(messages(evs)).toEqual([]);
      expect(evs).toEqual([{ kind: "tool-progress", toolCallId: TOOL_ID, toolName: "Write" }]);
    }

    // The rawInput frame (captured: title mutates to a human phrase here —
    // the tool name must still come from the start frame).
    const evs = t.translate({
      sessionUpdate: "tool_call_update",
      toolCallId: TOOL_ID,
      title: "Writing out.txt",
      kind: "edit",
      status: "in_progress",
      rawInput: { path: "out.txt", content: "papaya" },
      content: [{ type: "content", content: { type: "text", text: '{"path":"out.txt","content":"papaya"}' } }],
    });
    expect(messages(evs)).toEqual([
      {
        type: "assistant",
        content: [{
          type: "tool_use",
          id: TOOL_ID,
          name: "Write",
          input: { path: "out.txt", content: "papaya" },
        }],
      },
    ]);

    // Terminal frame → tool_result from rawOutput.
    const done = t.translate({
      sessionUpdate: "tool_call_update",
      toolCallId: TOOL_ID,
      status: "completed",
      content: [{ type: "content", content: { type: "text", text: "Wrote 6 bytes to out.txt" } }],
      rawOutput: "Wrote 6 bytes to out.txt",
    });
    expect(messages(done)).toEqual([
      {
        type: "user",
        content: [{ type: "tool_result", tool_use_id: TOOL_ID, content: "Wrote 6 bytes to out.txt" }],
      },
    ]);

    // A stray update after settle is ignored.
    expect(t.translate({ sessionUpdate: "tool_call_update", toolCallId: TOOL_ID, status: "completed" })).toEqual([]);
  });

  it("flushes buffered thinking before the tool_use block so ordering matches the wire", () => {
    const t = new AcpSessionTranslator();
    t.translate({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Planning the write." } });
    const evs = startWrite(t);
    expect(messages(evs)).toEqual([
      { type: "assistant", content: [{ type: "thinking", thinking: "Planning the write." }] },
    ]);
  });

  it("marks a failed tool call's result with is_error (captured Read failure)", () => {
    const t = new AcpSessionTranslator();
    const READ_ID = "0:tool_yLKCUgy8yROWKNcwsWy5gBFy";
    t.translate({ sessionUpdate: "tool_call", toolCallId: READ_ID, title: "Read", kind: "read", status: "pending" });
    t.translate({
      sessionUpdate: "tool_call_update",
      toolCallId: READ_ID,
      status: "in_progress",
      rawInput: { path: "existing.txt" },
    });
    const done = t.translate({
      sessionUpdate: "tool_call_update",
      toolCallId: READ_ID,
      status: "failed",
      content: [{ type: "content", content: { type: "text", text: '"existing.txt" does not exist.' } }],
      rawOutput: '"existing.txt" does not exist.',
    });
    expect(messages(done)).toEqual([
      {
        type: "user",
        content: [{
          type: "tool_result",
          tool_use_id: READ_ID,
          content: '"existing.txt" does not exist.',
          is_error: true,
        }],
      },
    ]);
  });

  it("synthesizes an input-less tool_use when a tool settles without ever carrying rawInput", () => {
    const t = new AcpSessionTranslator();
    t.translate({ sessionUpdate: "tool_call", toolCallId: "x:1", title: "Bash", kind: "execute", status: "pending" });
    const done = t.translate({
      sessionUpdate: "tool_call_update",
      toolCallId: "x:1",
      status: "completed",
      rawOutput: "ok\n",
    });
    expect(messages(done)).toEqual([
      { type: "assistant", content: [{ type: "tool_use", id: "x:1", name: "Bash", input: {} }] },
      { type: "user", content: [{ type: "tool_result", tool_use_id: "x:1", content: "ok\n" }] },
    ]);
  });

  it("stringifies non-string rawOutput and falls back to content text when rawOutput is absent", () => {
    const t = new AcpSessionTranslator();
    t.translate({ sessionUpdate: "tool_call", toolCallId: "y:1", title: "Custom", status: "pending" });
    const done = t.translate({
      sessionUpdate: "tool_call_update",
      toolCallId: "y:1",
      status: "completed",
      rawOutput: { bytes: 6, path: "out.txt" },
    });
    const result = messages(done)[1];
    expect(result.content[0]).toMatchObject({ type: "tool_result", content: '{"bytes":6,"path":"out.txt"}' });

    const t2 = new AcpSessionTranslator();
    t2.translate({ sessionUpdate: "tool_call", toolCallId: "z:1", title: "Custom", status: "pending" });
    const done2 = t2.translate({
      sessionUpdate: "tool_call_update",
      toolCallId: "z:1",
      status: "completed",
      content: [{ type: "content", content: { type: "text", text: "only-in-content" } }],
    });
    expect(messages(done2)[1].content[0]).toMatchObject({ type: "tool_result", content: "only-in-content" });
  });

  it("exposes toolName() so permission cards can resolve the real tool name", () => {
    const t = new AcpSessionTranslator();
    t.translate({ sessionUpdate: "tool_call", toolCallId: "p:1", title: "Bash", kind: "execute", status: "pending" });
    expect(t.toolName("p:1")).toBe("Bash");
    expect(t.toolName("nope")).toBeUndefined();
  });
});

describe("AcpSessionTranslator — session-level updates", () => {
  it("surfaces available_commands_update as a commands event", () => {
    const t = new AcpSessionTranslator();
    const evs = t.translate({
      sessionUpdate: "available_commands_update",
      availableCommands: [
        { name: "compact", description: "Compact the conversation context" },
        { name: "status", description: "Show current session status" },
      ],
    });
    expect(evs).toEqual([
      {
        kind: "commands",
        commands: [
          { name: "compact", description: "Compact the conversation context" },
          { name: "status", description: "Show current session status" },
        ],
      },
    ]);
  });

  it("ignores user_message_chunk (session/load history replay)", () => {
    const t = new AcpSessionTranslator();
    expect(
      t.translate({ sessionUpdate: "user_message_chunk", content: { type: "text", text: "old prompt" } }),
    ).toEqual([]);
  });

  it("reports unknown sessionUpdate kinds instead of crashing", () => {
    const t = new AcpSessionTranslator();
    expect(t.translate({ sessionUpdate: "future_frame_kind", payload: 1 } as never)).toEqual([
      { kind: "unknown", sessionUpdate: "future_frame_kind" },
    ]);
  });
});

describe("parseModelConfig", () => {
  it("extracts current model + available list from captured configOptions", () => {
    // Captured verbatim from `session/new` on Kimi Code CLI 0.26.0 (trimmed).
    const configOptions = [
      {
        type: "select",
        id: "model",
        name: "Model",
        category: "model",
        currentValue: "kimi-code/k3",
        options: [
          { value: "kimi-code/kimi-for-coding", name: "K2.7 Coding" },
          { value: "kimi-code/k3", name: "K3" },
          { value: "moonshot-cn/kimi-k2.6", name: "kimi-k2.6" },
        ],
      },
      { type: "select", id: "thinking", name: "Thinking", category: "thought_level", currentValue: "on" },
    ];
    expect(parseModelConfig(configOptions)).toEqual({
      current: "kimi-code/k3",
      available: [
        { id: "kimi-code/kimi-for-coding", name: "K2.7 Coding" },
        { id: "kimi-code/k3", name: "K3" },
        { id: "moonshot-cn/kimi-k2.6", name: "kimi-k2.6" },
      ],
    });
  });

  it("returns null when configOptions is missing or has no model entry", () => {
    expect(parseModelConfig(undefined)).toBeNull();
    expect(parseModelConfig([{ type: "select", id: "mode" }])).toBeNull();
  });
});
