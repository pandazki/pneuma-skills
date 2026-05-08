import { describe, expect, it } from "bun:test";
import {
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

  it("translates a tool result by collapsing text parts and exposing tool_call_id", () => {
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
            content: "<system>ok</system>\nhello\n",
          },
        ],
      },
    ]);
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

describe("pneumaUserToKimi", () => {
  it("wraps a string into a kimi user message", () => {
    expect(pneumaUserToKimi("hi")).toEqual({ role: "user", content: "hi" });
  });
});
