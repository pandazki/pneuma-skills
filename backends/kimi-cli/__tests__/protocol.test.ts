import { describe, expect, it } from "bun:test";
import {
  extractKimiSystemMetadata,
  parseKimiLine,
  kimiToPneumaMessages,
  pneumaUserToKimi,
  type KimiAssistantMessage,
  type KimiToolMessage,
} from "../protocol.js";

describe("parseKimiLine", () => {
  it("parses an assistant text-only message", () => {
    const msg = parseKimiLine('{"role":"assistant","content":" OK"}');
    expect(msg).toEqual({ role: "assistant", content: " OK" });
  });

  it("parses an assistant message with tool_calls", () => {
    const raw = `{"role":"assistant","content":" ","tool_calls":[{"type":"function","id":"functions.Shell:0","function":{"name":"Shell","arguments":"{\\"command\\":\\"ls\\"}"}}]}`;
    const msg = parseKimiLine(raw) as KimiAssistantMessage;
    expect(msg.tool_calls?.[0].id).toBe("functions.Shell:0");
    expect(msg.tool_calls?.[0].function.name).toBe("Shell");
  });

  it("parses a tool result with multi-part content", () => {
    const raw = `{"role":"tool","content":[{"type":"text","text":"<system>ok</system>"},{"type":"text","text":"hello\\n"}],"tool_call_id":"functions.Shell:0"}`;
    const msg = parseKimiLine(raw) as KimiToolMessage;
    expect(msg.role).toBe("tool");
    expect(Array.isArray(msg.content)).toBe(true);
    expect(msg.tool_call_id).toBe("functions.Shell:0");
  });

  it("returns null for blank or unparseable lines", () => {
    expect(parseKimiLine("")).toBeNull();
    expect(parseKimiLine("not-json")).toBeNull();
    expect(parseKimiLine("{}" /* missing role */)).toBeNull();
  });
});

describe("kimiToPneumaMessages", () => {
  it("translates an assistant text message into a single text content block", () => {
    const out = kimiToPneumaMessages({ role: "assistant", content: "Hello" });
    expect(out).toEqual([
      {
        type: "assistant",
        content: [{ type: "text", text: "Hello" }],
      },
    ]);
  });

  it("translates an assistant message with array content (managed kimi-code shape)", () => {
    // The managed `kimi-code` subscription provider emits the assistant's
    // reasoning as a separate `{type:"think"}` part alongside the answer
    // `{type:"text"}` part. Old code crashed on this shape because it tried
    // to call `.trim()` on the array — regression-pin the new behavior.
    const out = kimiToPneumaMessages({
      role: "assistant",
      content: [
        { type: "think", think: "Let me think about this.", encrypted: null },
        { type: "text", text: "OK" },
      ],
    });
    expect(out).toEqual([
      {
        type: "assistant",
        content: [
          { type: "thinking", thinking: "Let me think about this." },
          { type: "text", text: "OK" },
        ],
      },
    ]);
  });

  it("skips empty/whitespace text and think parts when array content is mixed", () => {
    const out = kimiToPneumaMessages({
      role: "assistant",
      content: [
        { type: "think", think: "   " }, // whitespace-only — skip
        { type: "text", text: "" }, // empty — skip
        { type: "think", think: "real reasoning" },
        { type: "text", text: "final" },
      ],
    });
    expect(out[0].content).toEqual([
      { type: "thinking", thinking: "real reasoning" },
      { type: "text", text: "final" },
    ]);
  });

  it("translates an assistant message with tool_calls into separate tool_use blocks", () => {
    const kimi: KimiAssistantMessage = {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          type: "function",
          id: "functions.Shell:0",
          function: { name: "Shell", arguments: '{"command":"ls"}' },
        },
      ],
    };
    const out = kimiToPneumaMessages(kimi);
    expect(out).toHaveLength(1);
    expect(out[0].content).toEqual([
      { type: "tool_use", id: "functions.Shell:0", name: "Shell", input: { command: "ls" } },
    ]);
  });

  it("translates a tool result, lifting the leading <system> wrapper into metadata", () => {
    const kimi: KimiToolMessage = {
      role: "tool",
      tool_call_id: "functions.Shell:0",
      content: [
        { type: "text", text: "<system>ok</system>" },
        { type: "text", text: "hello\n" },
      ],
    };
    const out = kimiToPneumaMessages(kimi);
    expect(out).toEqual([
      {
        type: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "functions.Shell:0",
            content: "hello\n",
            metadata: "ok",
          },
        ],
      },
    ]);
  });

  it("translates a status-only tool result into metadata + empty content", () => {
    // Shell sometimes prints only the system status with no stdout — kimi
    // still wraps it in `<system>...</system>`. The body should end up empty
    // after stripping; the frontend renders just the status header.
    const kimi: KimiToolMessage = {
      role: "tool",
      tool_call_id: "functions.Shell:0",
      content: [{ type: "text", text: "<system>Command executed successfully.</system>" }],
    };
    const out = kimiToPneumaMessages(kimi);
    expect(out[0].content[0]).toEqual({
      type: "tool_result",
      tool_use_id: "functions.Shell:0",
      content: "",
      metadata: "Command executed successfully.",
    });
  });

  it("leaves tool_result.metadata unset when the body has no <system> wrapper", () => {
    const kimi: KimiToolMessage = {
      role: "tool",
      tool_call_id: "id",
      content: "just plain output\n",
    };
    const out = kimiToPneumaMessages(kimi);
    const block = out[0].content[0] as { metadata?: string; content: string };
    expect(block.content).toBe("just plain output\n");
    expect("metadata" in block).toBe(false);
  });

  it("leaves interior <system> tags inside the body alone", () => {
    // Only LEADING <system> wrappers get lifted. A tag deep in the body —
    // e.g. an LLM-generated output that happens to mention `<system>` —
    // stays as-is.
    const kimi: KimiToolMessage = {
      role: "tool",
      tool_call_id: "id",
      content: [
        { type: "text", text: "<system>head</system>" },
        { type: "text", text: "real body\n<system>nested-not-lifted</system> trailing\n" },
      ],
    };
    const out = kimiToPneumaMessages(kimi);
    expect(out[0].content[0]).toEqual({
      type: "tool_result",
      tool_use_id: "id",
      content: "real body\n<system>nested-not-lifted</system> trailing\n",
      metadata: "head",
    });
  });

  it("tolerates malformed tool-call arguments by stringifying them", () => {
    const kimi: KimiAssistantMessage = {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          type: "function",
          id: "x",
          function: { name: "X", arguments: "not-json" },
        },
      ],
    };
    const out = kimiToPneumaMessages(kimi);
    expect(out[0].content[0]).toMatchObject({
      type: "tool_use",
      id: "x",
      name: "X",
      input: { _raw: "not-json" },
    });
  });
});

describe("extractKimiSystemMetadata", () => {
  it("returns null metadata when no leading <system> wrapper is present", () => {
    expect(extractKimiSystemMetadata("plain output")).toEqual({
      metadata: null,
      content: "plain output",
    });
  });

  it("lifts a single leading wrapper", () => {
    expect(extractKimiSystemMetadata("<system>ok</system>\nbody\n")).toEqual({
      metadata: "ok",
      content: "body\n",
    });
  });

  it("joins multiple consecutive leading wrappers with a separator", () => {
    expect(extractKimiSystemMetadata("<system>part-1</system> <system>part-2</system>body")).toEqual({
      metadata: "part-1 · part-2",
      content: "body",
    });
  });

  it("treats a status-only payload as metadata with empty content", () => {
    expect(extractKimiSystemMetadata("<system>Command executed successfully.</system>")).toEqual({
      metadata: "Command executed successfully.",
      content: "",
    });
  });
});

describe("pneumaUserToKimi", () => {
  it("wraps a string into a kimi user message", () => {
    expect(pneumaUserToKimi("hi")).toEqual({ role: "user", content: "hi" });
  });
});
