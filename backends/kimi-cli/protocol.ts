/**
 * Kimi CLI protocol — message shapes (OpenAI Chat Completions style) emitted on
 * stdout when running `kimi --print --output-format stream-json`, plus pure
 * translation functions to/from Pneuma's normalized message shape.
 *
 * Shapes verified empirically against kimi-cli v1.41.0 in `/tmp/kimi-probe/`.
 * No IO in this module — keep it pure so it can be unit-tested without a
 * running kimi process.
 */

export interface KimiUserMessage {
  role: "user";
  content: string;
}

export interface KimiToolCall {
  type: "function";
  id: string;
  function: { name: string; arguments: string };
}

export interface KimiAssistantMessage {
  role: "assistant";
  content: string;
  tool_calls?: KimiToolCall[];
}

export interface KimiToolMessage {
  role: "tool";
  tool_call_id: string;
  content: string | Array<{ type: "text"; text: string }>;
}

export type KimiMessage = KimiUserMessage | KimiAssistantMessage | KimiToolMessage;

// ── Pneuma-side normalized shapes (subset; matches what ws-bridge broadcasts) ─

export interface PneumaTextBlock {
  type: "text";
  text: string;
}
export interface PneumaToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}
export interface PneumaToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
}

export type PneumaContentBlock =
  | PneumaTextBlock
  | PneumaToolUseBlock
  | PneumaToolResultBlock;

export interface PneumaAssistantMessage {
  type: "assistant";
  content: PneumaContentBlock[];
}
export interface PneumaUserMessage {
  type: "user";
  content: PneumaContentBlock[];
}

export type PneumaMessage = PneumaAssistantMessage | PneumaUserMessage;

// ── Parsing ──────────────────────────────────────────────────────────────────

export function parseKimiLine(raw: string): KimiMessage | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const role = (parsed as { role?: unknown }).role;
  if (role !== "user" && role !== "assistant" && role !== "tool") return null;
  return parsed as KimiMessage;
}

// ── kimi → Pneuma ────────────────────────────────────────────────────────────

export function kimiToPneumaMessages(msg: KimiMessage): PneumaMessage[] {
  if (msg.role === "user") {
    return [{ type: "user", content: [{ type: "text", text: msg.content }] }];
  }

  if (msg.role === "assistant") {
    const blocks: PneumaContentBlock[] = [];
    const text = (msg.content ?? "").trim();
    if (text.length > 0 && !msg.tool_calls?.length) {
      blocks.push({ type: "text", text: msg.content });
    } else if (text.length > 0 && msg.tool_calls?.length) {
      // Some assistant turns ship narration alongside a tool call.
      blocks.push({ type: "text", text: msg.content });
    }
    for (const call of msg.tool_calls ?? []) {
      let input: Record<string, unknown>;
      try {
        const parsed = JSON.parse(call.function.arguments);
        input = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : { _raw: call.function.arguments };
      } catch {
        input = { _raw: call.function.arguments };
      }
      blocks.push({ type: "tool_use", id: call.id, name: call.function.name, input });
    }
    if (blocks.length === 0) return [];
    return [{ type: "assistant", content: blocks }];
  }

  // role === "tool"
  const text = typeof msg.content === "string"
    ? msg.content
    : msg.content.map((p) => p.text).join("\n");
  return [
    {
      type: "user",
      content: [
        { type: "tool_result", tool_use_id: msg.tool_call_id, content: text },
      ],
    },
  ];
}

// ── Pneuma → kimi ────────────────────────────────────────────────────────────

export function pneumaUserToKimi(content: string): KimiUserMessage {
  return { role: "user", content };
}
