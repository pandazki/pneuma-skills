/**
 * Per-backend bridge handler — lifecycle hooks for non-CLI-WebSocket adapters.
 *
 * Pneuma's `WsBridge` historically carried a separate `Map` per non-Claude
 * backend (codex, kimi-cli) plus inline `if (backendType === "...")` branches
 * at every place a browser-originated message had to be routed back to the
 * agent. Each new backend doubled the surface that switched on backend type.
 *
 * This module replaces that pattern with a single `BridgeBackend` interface.
 * Each backend implements it in its own file (`ws-bridge-kimi.ts`,
 * `ws-bridge-codex.ts`) and `WsBridge` only knows how to dispatch through the
 * interface — it never asks "is this codex or kimi?". Adding a backend means
 * writing a new `BridgeBackend` class; the bridge's main routing code stays
 * untouched.
 *
 * The interface is per-instance — one `BridgeBackend` is constructed per
 * session and closes over its adapter, so method signatures stay narrow
 * (no `(adapter, session, deps, msg)` quadruples threading through the
 * bridge). Adapter type is kept private to each implementation; the bridge
 * never sees it.
 */

import type { AgentBackendType } from "../core/types/agent-backend.js";
import type { BrowserIncomingMessage, BrowserOutgoingMessage } from "./session-types.js";
import type { Session } from "./ws-bridge-types.js";

/**
 * Cross-cutting bridge dependencies a backend handler may use during its
 * lifecycle. Passed once at construction; stays stable across the session.
 */
export interface BridgeBackendDeps {
  /** Broadcast a message to all browsers attached to a session. */
  broadcastToBrowsers: (session: Session, msg: BrowserIncomingMessage) => void;
  /** Workspace path — used by checkpoint hooks etc. */
  workspace: string;
  /**
   * Notify the bridge that we've learned the agent's internal session id
   * (Claude Code's `session_id`, Codex's thread id, kimi's session UUID).
   * Bridge persists this to `session.json#agentSessionId` for resume.
   */
  onAgentSessionId?: (sessionId: string, agentSessionId: string) => void;
}

/**
 * Result of `BridgeBackend.routeBrowserMessage` — tells the bridge what to do
 * with the message after the handler returns.
 */
export type RouteResult =
  /** Handler consumed the message. Bridge stops further dispatch. */
  | "handled"
  /**
   * Backend explicitly doesn't support this message type (e.g. kimi has no
   * permission flow). Bridge stops dispatch so the message doesn't queue
   * indefinitely in `pendingMessages`. Distinct from `"handled"` only for
   * diagnostics.
   */
  | "unsupported"
  /**
   * Backend doesn't claim ownership of this message type (e.g. viewer_action
   * is bridge-internal, not backend). Bridge falls through to its own
   * default handling.
   */
  | "passthrough";

/**
 * Per-session bridge handler. One instance per attached session — closes over
 * its adapter, session id, and bridge deps.
 *
 * Backend implementations:
 *   - `ws-bridge-kimi.ts` — `KimiBridge` (kimi-cli stdio NDJSON adapter)
 *   - `ws-bridge-codex.ts` — `CodexBridge` (codex JSON-RPC adapter)
 */
export interface BridgeBackend {
  /** Backend kind — used by the bridge for diagnostics + the `is*Session` predicates. */
  readonly backendType: AgentBackendType;

  /**
   * Wire adapter events to the bridge: subscribe to assistant/tool_result
   * messages, session id, disconnect; broadcast `cli_connected`; flush any
   * `pendingMessages` queued before this backend was ready; synthesise
   * `session_init` if the underlying protocol doesn't emit one. Called once
   * after the backend is attached.
   */
  attach(): void;

  /**
   * Forward a server-injected user message (greeting, env tag, handoff
   * cancel, etc.) to the agent. Plain text only — no images/files.
   */
  injectUserMessage(content: string): void;

  /**
   * Route a browser-originated outgoing message. Each backend declares which
   * message types it owns; the bridge respects the result:
   *   - `"handled"` / `"unsupported"` → stop dispatch
   *   - `"passthrough"` → bridge tries its own handlers (viewer_action, etc.)
   */
  routeBrowserMessage(msg: BrowserOutgoingMessage): RouteResult;

  /**
   * Disconnect the underlying adapter (e.g. kill the process). Idempotent.
   * The bridge calls this when the session is closed.
   */
  disconnect(): Promise<void>;
}
