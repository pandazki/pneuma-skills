/**
 * Kimi Code ACP protocol — wire shapes for the `session/update` notification
 * stream emitted by `kimi acp` (Agent Client Protocol over stdio JSON-RPC),
 * plus a stateful translator from that stream to Pneuma's normalized message
 * shape.
 *
 * Wire shapes verified empirically against Kimi Code CLI 0.26.0 (every frame
 * kind below was captured live, not read from docs). No IO in this module —
 * the translator is a pure state machine so it can be unit-tested without a
 * running kimi process.
 *
 * Key empirical facts the translation depends on:
 *
 *   - `tool_call` (the start frame) carries the REAL tool name in `title`
 *     ("Write", "Read", "Bash", "Glob", …). Later `tool_call_update` frames
 *     mutate `title` into a human phrase ("Writing out.txt") — so the tool
 *     name must be captured from the start frame only.
 *   - A single `toolCallId` fires many `tool_call_update` frames whose
 *     `content[].content.text` is a *growing partial JSON string* of the
 *     arguments as the model generates them. Those partials are NEVER
 *     parsed — the structured input arrives once as a real `rawInput`
 *     object, and that frame is the signal to emit the `tool_use` block.
 *   - The terminal update (`status: "completed" | "failed"`) carries the
 *     result in `rawOutput` (string for the builtin tools; tolerate
 *     objects by JSON-stringifying).
 *   - `session/load` replays history as `user_message_chunk` /
 *     `agent_*_chunk` frames; `user_message_chunk` is deliberately ignored
 *     (Pneuma rehydrates chat history from its own `history.json`).
 */

// ── ACP wire shapes (agent → client `session/update` payloads) ───────────────

/** `{type:"text",text}` content payload used by chunk updates. */
export interface AcpTextContent {
  type: "text";
  text: string;
}

/** Entry of a tool call's `content[]` array. */
export interface AcpToolCallContent {
  type: "content";
  content: AcpTextContent;
}

export type AcpToolCallStatus = "pending" | "in_progress" | "completed" | "failed";

export interface AcpToolCallStart {
  sessionUpdate: "tool_call";
  toolCallId: string;
  /** Real tool name on this start frame ("Write", "Read", "Bash", …). */
  title: string;
  kind?: string;
  status: AcpToolCallStatus;
  content?: AcpToolCallContent[];
}

export interface AcpToolCallUpdate {
  sessionUpdate: "tool_call_update";
  toolCallId: string;
  /** Human phrase on update frames ("Writing out.txt") — NOT the tool name. */
  title?: string;
  kind?: string;
  status?: AcpToolCallStatus;
  /** Structured tool input — present exactly when argument generation finished. */
  rawInput?: Record<string, unknown>;
  /** Tool result — present on the terminal (completed/failed) frame. */
  rawOutput?: unknown;
  content?: AcpToolCallContent[];
}

export interface AcpAgentMessageChunk {
  sessionUpdate: "agent_message_chunk";
  content: AcpTextContent;
}

export interface AcpAgentThoughtChunk {
  sessionUpdate: "agent_thought_chunk";
  content: AcpTextContent;
}

export interface AcpAvailableCommand {
  name: string;
  description?: string;
  input?: Record<string, unknown>;
}

export interface AcpAvailableCommandsUpdate {
  sessionUpdate: "available_commands_update";
  availableCommands: AcpAvailableCommand[];
}

/** Replayed by `session/load`; carries the historical user prompt. Ignored. */
export interface AcpUserMessageChunk {
  sessionUpdate: "user_message_chunk";
  content: AcpTextContent;
}

export type AcpSessionUpdate =
  | AcpToolCallStart
  | AcpToolCallUpdate
  | AcpAgentMessageChunk
  | AcpAgentThoughtChunk
  | AcpAvailableCommandsUpdate
  | AcpUserMessageChunk;

// ── ACP session-setup shapes ─────────────────────────────────────────────────

/** One entry of `session/new`'s `configOptions[]` result field. */
export interface AcpConfigOption {
  type: string;
  id: string;
  name?: string;
  category?: string;
  currentValue?: string;
  options?: { value: string; name?: string; description?: string }[];
}

export interface AcpPermissionOption {
  optionId: string;
  name?: string;
  kind: "allow_once" | "allow_always" | "reject_once" | "reject_always" | string;
}

/** Params of the agent→client `session/request_permission` request. */
export interface AcpPermissionRequestParams {
  sessionId: string;
  options: AcpPermissionOption[];
  toolCall?: {
    toolCallId?: string;
    /** Tool name at request time (matches the tool_call start frame's title). */
    title?: string;
    content?: AcpToolCallContent[];
  };
}

/** `session/prompt` resolves with this at end of turn. */
export interface AcpPromptResult {
  stopReason: string;
}

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
  /** Set when the tool call ended with ACP `status: "failed"`. */
  is_error?: boolean;
  /**
   * Optional inline status header rendered above the result body. Part of
   * the preserved output contract (the chat panel renders it generically);
   * the ACP stream carries no equivalent, so kimi no longer sets it.
   */
  metadata?: string;
}

/**
 * Internal reasoning surfaced as a separate content block. ACP streams these
 * as `agent_thought_chunk` frames; we accumulate and emit Pneuma's canonical
 * `thinking` block so the chat panel's existing `ThinkingBlock` component
 * renders them as a collapsible reasoning card.
 */
export interface PneumaThinkingBlock {
  type: "thinking";
  thinking: string;
}

export type PneumaContentBlock =
  | PneumaTextBlock
  | PneumaToolUseBlock
  | PneumaToolResultBlock
  | PneumaThinkingBlock;

export interface PneumaAssistantMessage {
  type: "assistant";
  content: PneumaContentBlock[];
}
export interface PneumaUserMessage {
  type: "user";
  content: PneumaContentBlock[];
}

export type PneumaMessage = PneumaAssistantMessage | PneumaUserMessage;

// ── Translator events ────────────────────────────────────────────────────────

/**
 * What one `session/update` payload translates into. A single frame can yield
 * several events (e.g. a `tool_call` start flushes buffered text first).
 */
export type AcpTranslationEvent =
  /** A complete Pneuma message ready to broadcast + record in history. */
  | { kind: "message"; message: PneumaMessage }
  /** A streaming token — live-typing feedback, not recorded in history. */
  | { kind: "delta"; deltaType: "text" | "thinking"; text: string }
  /** The agent's slash-command inventory changed. */
  | { kind: "commands"; commands: AcpAvailableCommand[] }
  /** A tool call is executing / still generating arguments. */
  | { kind: "tool-progress"; toolCallId: string; toolName: string }
  /** Unrecognized `sessionUpdate` — surfaced so the adapter can log once. */
  | { kind: "unknown"; sessionUpdate: string };

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Extract the model config option from `session/new`/`session/resume` results. */
export function parseModelConfig(
  configOptions: AcpConfigOption[] | undefined,
): { current: string; available: { id: string; name?: string }[] } | null {
  const model = configOptions?.find((o) => o.id === "model");
  if (!model) return null;
  return {
    current: model.currentValue ?? "",
    available: (model.options ?? []).map((o) => ({ id: o.value, name: o.name })),
  };
}

function stringifyRawOutput(rawOutput: unknown, fallback: AcpToolCallContent[] | undefined): string {
  if (typeof rawOutput === "string") return rawOutput;
  if (rawOutput !== undefined && rawOutput !== null) {
    try {
      return JSON.stringify(rawOutput);
    } catch {
      return String(rawOutput);
    }
  }
  // No rawOutput — fall back to the terminal frame's content text (observed
  // to mirror rawOutput for builtin tools; covers hypothetical tools that
  // only populate content).
  const text = (fallback ?? [])
    .map((c) => (c?.content?.type === "text" ? c.content.text : ""))
    .join("");
  return text;
}

// ── Translator ───────────────────────────────────────────────────────────────

interface ToolState {
  /** Real tool name, captured from the `tool_call` start frame's title. */
  name: string;
  /** Whether the `tool_use` block has been emitted (rawInput seen). */
  emittedUse: boolean;
  /** Whether the terminal tool_result has been emitted. */
  settled: boolean;
}

/**
 * Stateful ACP `session/update` → Pneuma translator. One instance per agent
 * session; feed every update payload through `translate()` and flush at turn
 * end with `endTurn()`.
 *
 * Buffering model: consecutive `agent_thought_chunk` / `agent_message_chunk`
 * tokens accumulate into one pending block each; a boundary (kind switch,
 * tool call start, turn end) flushes the buffer as a complete message. Every
 * token is also surfaced as a `delta` event for live streaming.
 */
export class AcpSessionTranslator {
  private pendingText = "";
  private pendingThinking = "";
  private tools = new Map<string, ToolState>();

  translate(update: AcpSessionUpdate | Record<string, unknown>): AcpTranslationEvent[] {
    const kind = (update as { sessionUpdate?: unknown }).sessionUpdate;
    switch (kind) {
      case "agent_message_chunk": {
        const text = (update as AcpAgentMessageChunk).content?.text ?? "";
        if (!text) return [];
        const events = this.flushThinking();
        this.pendingText += text;
        events.push({ kind: "delta", deltaType: "text", text });
        return events;
      }
      case "agent_thought_chunk": {
        const text = (update as AcpAgentThoughtChunk).content?.text ?? "";
        if (!text) return [];
        const events = this.flushText();
        this.pendingThinking += text;
        events.push({ kind: "delta", deltaType: "thinking", text });
        return events;
      }
      case "tool_call":
        return this.onToolCallStart(update as AcpToolCallStart);
      case "tool_call_update":
        return this.onToolCallUpdate(update as AcpToolCallUpdate);
      case "available_commands_update":
        return [{
          kind: "commands",
          commands: (update as AcpAvailableCommandsUpdate).availableCommands ?? [],
        }];
      case "user_message_chunk":
        // History replay from `session/load` — Pneuma rehydrates chat history
        // from its own history.json, so replayed prompts are dropped.
        return [];
      default:
        return [{ kind: "unknown", sessionUpdate: String(kind) }];
    }
  }

  /**
   * Turn boundary — `session/prompt` resolved. Flushes any buffered text /
   * thinking so nothing is lost when the turn ends mid-buffer.
   */
  endTurn(): AcpTranslationEvent[] {
    return [...this.flushThinking(), ...this.flushText()];
  }

  /** Look up the real tool name for a toolCallId (used for permission cards). */
  toolName(toolCallId: string): string | undefined {
    return this.tools.get(toolCallId)?.name;
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private onToolCallStart(update: AcpToolCallStart): AcpTranslationEvent[] {
    const events = [...this.flushThinking(), ...this.flushText()];
    this.tools.set(update.toolCallId, {
      name: update.title || "tool",
      emittedUse: false,
      settled: false,
    });
    return events;
  }

  private onToolCallUpdate(update: AcpToolCallUpdate): AcpTranslationEvent[] {
    let tool = this.tools.get(update.toolCallId);
    if (!tool) {
      // Update for a tool we never saw start (shouldn't happen; be tolerant).
      tool = { name: update.title || "tool", emittedUse: false, settled: false };
      this.tools.set(update.toolCallId, tool);
    }
    if (tool.settled) return [];

    const events: AcpTranslationEvent[] = [];

    // Structured input arrived → emit the tool_use block exactly once. The
    // earlier partial-JSON streaming frames are deliberately not parsed.
    if (!tool.emittedUse && update.rawInput && typeof update.rawInput === "object") {
      tool.emittedUse = true;
      events.push(...this.flushThinking(), ...this.flushText());
      events.push({
        kind: "message",
        message: {
          type: "assistant",
          content: [{
            type: "tool_use",
            id: update.toolCallId,
            name: tool.name,
            input: update.rawInput,
          }],
        },
      });
    }

    if (update.status === "completed" || update.status === "failed") {
      tool.settled = true;
      // Auto-approved tools can theoretically settle without ever carrying
      // rawInput; emit an input-less tool_use so the result has a pair.
      if (!tool.emittedUse) {
        tool.emittedUse = true;
        events.push(...this.flushThinking(), ...this.flushText());
        events.push({
          kind: "message",
          message: {
            type: "assistant",
            content: [{ type: "tool_use", id: update.toolCallId, name: tool.name, input: {} }],
          },
        });
      }
      const resultBlock: PneumaToolResultBlock = {
        type: "tool_result",
        tool_use_id: update.toolCallId,
        content: stringifyRawOutput(update.rawOutput, update.content),
      };
      if (update.status === "failed") resultBlock.is_error = true;
      events.push({ kind: "message", message: { type: "user", content: [resultBlock] } });
      return events;
    }

    // Still pending / in_progress (argument streaming or execution).
    events.push({ kind: "tool-progress", toolCallId: update.toolCallId, toolName: tool.name });
    return events;
  }

  private flushText(): AcpTranslationEvent[] {
    if (this.pendingText.trim().length === 0) {
      this.pendingText = "";
      return [];
    }
    const text = this.pendingText;
    this.pendingText = "";
    return [{
      kind: "message",
      message: { type: "assistant", content: [{ type: "text", text }] },
    }];
  }

  private flushThinking(): AcpTranslationEvent[] {
    if (this.pendingThinking.trim().length === 0) {
      this.pendingThinking = "";
      return [];
    }
    const thinking = this.pendingThinking;
    this.pendingThinking = "";
    return [{
      kind: "message",
      message: { type: "assistant", content: [{ type: "thinking", thinking }] },
    }];
  }
}
