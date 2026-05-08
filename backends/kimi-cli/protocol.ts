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
  /**
   * Agent-facing status that kimi prepends to tool results in the form
   * `<system>...</system>` (see `kimi_cli/agents/default/system.md`). Extracted
   * here so the bridge can keep tool_result.content as just the actual stdout /
   * file body, and the frontend renders metadata as a small status header
   * above the result. Empty string when the tool result carries no metadata.
   */
  metadata?: string;
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
  const { metadata, content } = extractKimiSystemMetadata(text);
  const block: PneumaToolResultBlock = { type: "tool_result", tool_use_id: msg.tool_call_id, content };
  if (metadata) block.metadata = metadata;
  return [{ type: "user", content: [block] }];
}

// ── kimi `<system>` metadata extraction ──────────────────────────────────────

/**
 * Kimi-cli prepends agent-facing status to every tool result in the form
 * `<system>...</system>` (see `kimi_cli/agents/default/system.md` and the
 * various tool wrappers under `kimi_cli/tools/`). Examples:
 *
 *   - `<system>Command executed successfully.</system>` (Shell)
 *   - `<system>103 lines read from file starting from line 1. ...</system>`
 *     followed by the actual file body (ReadFile)
 *   - `<system>ERROR: ... is not an absolute path. ...</system>` (failed tool)
 *
 * These markers are noise for human display, so we lift them out of the body
 * here. Multiple `<system>` blocks (occasionally seen on multi-step tools)
 * are joined with " · " into a single metadata string. The remaining text —
 * with leading/trailing whitespace from the lift trimmed off but interior
 * whitespace preserved — is the body the user actually wants to see.
 *
 * Returns `metadata` as `null` when no markers are present so callers can
 * cheaply skip setting the optional field.
 */
export function extractKimiSystemMetadata(raw: string): { metadata: string | null; content: string } {
  // Non-greedy match across newlines; only consume `<system>` blocks anchored
  // at the start of the (remaining) buffer with optional leading whitespace.
  // We deliberately do NOT match `<system>` blocks deeper in the body — those
  // are part of the actual content and should stay visible.
  const headRe = /^\s*<system>([\s\S]*?)<\/system>\s*/;
  const parts: string[] = [];
  let rest = raw;
  while (true) {
    const m = rest.match(headRe);
    if (!m) break;
    parts.push(m[1].trim());
    rest = rest.slice(m[0].length);
  }
  if (parts.length === 0) {
    return { metadata: null, content: raw };
  }
  return {
    metadata: parts.join(" · "),
    // Preserve the body verbatim once the leading metadata is stripped.
    content: rest,
  };
}

// ── Pneuma → kimi ────────────────────────────────────────────────────────────

export function pneumaUserToKimi(content: string): KimiUserMessage {
  return { role: "user", content };
}
