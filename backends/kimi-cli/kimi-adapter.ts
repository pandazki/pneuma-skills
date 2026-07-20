/**
 * KimiAdapter — owns the ACP (Agent Client Protocol) conversation with a
 * spawned `kimi acp` process.
 *
 * Responsibilities:
 *   1. Run the handshake: `initialize` → `session/new` (or `session/resume`
 *      when resuming), fire `onSessionId` with the id returned by the RPC.
 *   2. Translate `session/update` notifications through `AcpSessionTranslator`
 *      and fan the resulting events out to the bridge's callbacks.
 *   3. Send user turns via `session/prompt` (one at a time — ACP's prompt
 *      resolves only at end of turn, so turns queue client-side) and fire
 *      `onTurnEnded` with the real `stopReason` when each resolves.
 *   4. Answer the agent→client `session/request_permission` round trip. The
 *      turn BLOCKS until answered — an unanswered request deadlocks the
 *      session, so pending requests are also resolved as `cancelled` on
 *      interrupt and rejected on disconnect.
 *   5. `interrupt()` sends the `session/cancel` notification (no signals —
 *      the ACP server cancels the in-flight turn and the pending
 *      `session/prompt` resolves with `stopReason: "cancelled"`).
 *   6. `setModel()` calls `session/set_model`; the model list arrives free in
 *      the session-setup result's `configOptions` and is surfaced via
 *      `onModels`.
 *
 * No browser/bridge knowledge here — the bridge wires these callbacks itself.
 */

import type { Readable, Writable } from "node:stream";
import { randomUUID } from "node:crypto";
import { AcpTransport } from "./acp-transport.js";
import {
  AcpSessionTranslator,
  parseModelConfig,
  type AcpAvailableCommand,
  type AcpConfigOption,
  type AcpPermissionRequestParams,
  type AcpPromptResult,
  type PneumaMessage,
} from "./protocol.js";

export interface KimiAdapterOptions {
  sessionId: string;
  stdin: Writable;
  stdout: Readable;
  stderr?: Readable;
  killProcess: () => Promise<void>;
  /** Workspace directory — passed as `cwd` to session setup. */
  cwd: string;
  /** ACP session id to resume (`session/resume`); omitted → `session/new`. */
  resumeSessionId?: string;
  /** Model to select after session setup (via `session/set_model`). */
  model?: string;
  /**
   * Pneuma permission mode (Claude vocabulary: "bypassPermissions",
   * "default", "acceptEdits", "plan"). Mapped onto ACP session modes and
   * applied via `session/set_mode` after setup. Omitted → "yolo", matching
   * Pneuma's production posture for the other backends (Claude launches
   * with `--permission-mode bypassPermissions` by default).
   */
  permissionMode?: string;
}

/**
 * Map Pneuma's Claude-vocabulary permission mode onto Kimi Code's ACP
 * session modes (`default` / `plan` / `auto` / `yolo`, verified in
 * `session/new` configOptions). Unknown values fall back to "default"
 * (ask) — never silently escalate to auto-approval.
 */
export function mapPermissionModeToAcp(permissionMode: string | undefined): string {
  switch (permissionMode) {
    case undefined:
    case "bypassPermissions":
    case "yolo":
      return "yolo";
    case "acceptEdits":
    case "auto":
      return "auto";
    case "plan":
      return "plan";
    default:
      return "default";
  }
}

export interface KimiPermissionRequest {
  /** Pneuma-side request id (UUID) — the browser echoes it back. */
  requestId: string;
  /** Real tool name ("Write", "Bash", …) resolved via the translator. */
  toolName: string;
  /** ACP toolCallId the request is about (pairs with the tool_use block). */
  toolUseId: string;
  /** Human-readable description from the request's toolCall content. */
  description: string;
}

export type PermissionBehavior = "allow" | "allowAlways" | "deny";

export interface KimiModelInfo {
  current: string;
  available: { id: string; name?: string }[];
}

export interface KimiTurnEnd {
  stopReason: string;
  /** True when the turn failed at the transport/RPC level (not a model stop). */
  isError: boolean;
}

interface PendingPermission {
  rpcId: number;
  optionIdByBehavior: Record<PermissionBehavior, string | undefined>;
}

interface QueuedPrompt {
  prompt: Array<Record<string, unknown>>;
}

export class KimiAdapter {
  readonly sessionId: string;

  private readonly transport: AcpTransport;
  private readonly translator = new AcpSessionTranslator();
  private readonly killProcess: () => Promise<void>;
  private readonly cwd: string;
  private readonly launchModel: string | undefined;
  private readonly permissionMode: string | undefined;
  private resumeSessionId: string | undefined;

  private messageHandlers: ((msg: PneumaMessage) => void)[] = [];
  private streamDeltaHandlers: ((delta: { deltaType: "text" | "thinking"; text: string }) => void)[] = [];
  private sessionIdHandlers: ((acpSessionId: string) => void)[] = [];
  private turnEndedHandlers: ((end: KimiTurnEnd) => void)[] = [];
  private permissionRequestHandlers: ((req: KimiPermissionRequest) => void)[] = [];
  private permissionCancelledHandlers: ((requestId: string) => void)[] = [];
  private modelsHandlers: ((models: KimiModelInfo) => void)[] = [];
  private commandsHandlers: ((commands: AcpAvailableCommand[]) => void)[] = [];
  private metaHandlers: ((meta: { agentVersion: string }) => void)[] = [];
  private toolProgressHandlers: ((progress: { toolCallId: string; toolName: string }) => void)[] = [];
  private errorHandlers: ((message: string) => void)[] = [];
  private disconnectHandlers: (() => void)[] = [];

  private acpSessionId: string | undefined;
  private lastEmittedSessionId: string | undefined;
  private disconnected = false;
  private initFailed = false;

  /** Turns queued until the handshake finishes / the previous turn resolves. */
  private promptQueue: QueuedPrompt[] = [];
  private promptInFlight = false;

  /** Pneuma request id → ACP JSON-RPC id + option mapping. */
  private pendingPermissions = new Map<string, PendingPermission>();

  /** sessionUpdate kinds already warned about (log unknown frames once). */
  private warnedUnknownKinds = new Set<string>();

  /** Whether the agent supports `session/resume` (from initialize result). */
  private supportsResume = false;
  /** Whether the prompt array may carry image content blocks. */
  private supportsImages = false;

  constructor(opts: KimiAdapterOptions) {
    this.sessionId = opts.sessionId;
    this.killProcess = opts.killProcess;
    this.cwd = opts.cwd;
    this.resumeSessionId = opts.resumeSessionId;
    this.launchModel = opts.model;
    this.permissionMode = opts.permissionMode;

    this.transport = new AcpTransport(opts.stdin, opts.stdout, `kimi-acp ${opts.sessionId}`);
    this.transport.onNotification((method, params) => this.onNotification(method, params));
    this.transport.onRequest((method, id, params) => this.onRequest(method, id, params));
    this.transport.onClose(() => this.fireDisconnect());

    opts.stderr?.on("data", (chunk: Buffer | string) => {
      // ACP stderr carries human-readable logs (JSON-RPC errors are echoed
      // there too) — forward verbatim for diagnostics.
      process.stderr.write(`[kimi ${this.sessionId}] ${chunk.toString("utf-8")}`);
    });

    void this.initialize();
  }

  // ── Subscription surface (bridge-facing) ───────────────────────────────────

  onMessage(cb: (msg: PneumaMessage) => void): void {
    this.messageHandlers.push(cb);
  }

  onStreamDelta(cb: (delta: { deltaType: "text" | "thinking"; text: string }) => void): void {
    this.streamDeltaHandlers.push(cb);
  }

  onSessionId(cb: (acpSessionId: string) => void): void {
    this.sessionIdHandlers.push(cb);
    // Replay-on-subscribe: the id is learned asynchronously (from the
    // session/new result), and the bridge attaches after launch() returns —
    // late subscribers must not miss an id that already arrived.
    if (this.lastEmittedSessionId) {
      try {
        cb(this.lastEmittedSessionId);
      } catch (err) {
        console.error(`[kimi-adapter ${this.sessionId}] sessionId handler error (replay):`, err);
      }
    }
  }

  onTurnEnded(cb: (end: KimiTurnEnd) => void): void {
    this.turnEndedHandlers.push(cb);
  }

  onPermissionRequest(cb: (req: KimiPermissionRequest) => void): void {
    this.permissionRequestHandlers.push(cb);
  }

  onPermissionCancelled(cb: (requestId: string) => void): void {
    this.permissionCancelledHandlers.push(cb);
  }

  onModels(cb: (models: KimiModelInfo) => void): void {
    this.modelsHandlers.push(cb);
  }

  onCommands(cb: (commands: AcpAvailableCommand[]) => void): void {
    this.commandsHandlers.push(cb);
  }

  onMeta(cb: (meta: { agentVersion: string }) => void): void {
    this.metaHandlers.push(cb);
  }

  onToolProgress(cb: (progress: { toolCallId: string; toolName: string }) => void): void {
    this.toolProgressHandlers.push(cb);
  }

  onError(cb: (message: string) => void): void {
    this.errorHandlers.push(cb);
  }

  onDisconnect(cb: () => void): void {
    this.disconnectHandlers.push(cb);
  }

  // ── Command surface (bridge-facing) ────────────────────────────────────────

  /**
   * Queue a user turn. Text always; images ride along as ACP image content
   * blocks when the agent declared `promptCapabilities.image`.
   */
  sendUserMessage(content: string, images?: { media_type: string; data: string }[]): void {
    if (this.disconnected || this.initFailed) return;
    const prompt: Array<Record<string, unknown>> = [{ type: "text", text: content }];
    if (this.supportsImages && images) {
      for (const img of images) {
        prompt.push({ type: "image", data: img.data, mimeType: img.media_type });
      }
    }
    this.promptQueue.push({ prompt });
    void this.drainPromptQueue();
  }

  /**
   * Cancel the in-flight turn via the `session/cancel` notification. The ACP
   * server aborts the turn and the pending `session/prompt` resolves with
   * `stopReason: "cancelled"` — that resolution (not this call) drives the
   * bridge's idle transition. Pending permission requests are answered with
   * the `cancelled` outcome, as the ACP contract requires from a cancelling
   * client.
   */
  interrupt(): void {
    if (this.disconnected || !this.acpSessionId) return;
    this.cancelPendingPermissions("cancelled");
    this.transport.notify("session/cancel", { sessionId: this.acpSessionId });
  }

  /** Answer a permission request previously surfaced via onPermissionRequest. */
  respondPermission(requestId: string, behavior: PermissionBehavior): void {
    const pending = this.pendingPermissions.get(requestId);
    if (!pending) {
      console.warn(`[kimi-adapter ${this.sessionId}] no pending permission for request ${requestId}`);
      return;
    }
    this.pendingPermissions.delete(requestId);
    const optionId = pending.optionIdByBehavior[behavior];
    if (!optionId) {
      // The agent offered no option of this kind — refuse rather than guess.
      this.transport.respond(pending.rpcId, { outcome: { outcome: "cancelled" } });
      return;
    }
    this.transport.respond(pending.rpcId, { outcome: { outcome: "selected", optionId } });
  }

  /** Switch the session model via `session/set_model`. */
  async setModel(modelId: string): Promise<void> {
    if (this.disconnected || !this.acpSessionId) {
      throw new Error("setModel: no active ACP session");
    }
    await this.transport.call("session/set_model", { sessionId: this.acpSessionId, modelId });
  }

  async disconnect(): Promise<void> {
    if (this.disconnected) return;
    this.disconnected = true;
    this.cancelPendingPermissions("cancelled");
    await this.killProcess();
    this.fireDisconnectHandlers();
  }

  // ── Handshake ──────────────────────────────────────────────────────────────

  private async initialize(): Promise<void> {
    try {
      const initResult = (await this.transport.call("initialize", {
        protocolVersion: 1,
        // Honest client capability declaration: Pneuma provides no client-side
        // fs or terminal services — kimi's builtin tools run agent-side
        // (verified end-to-end: Write/Read/Bash all execute in the agent with
        // these declared false).
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
        },
      })) as {
        agentCapabilities?: {
          loadSession?: boolean;
          promptCapabilities?: { image?: boolean };
          sessionCapabilities?: { resume?: unknown };
        };
        agentInfo?: { name?: string; version?: string };
      };

      this.supportsResume = initResult?.agentCapabilities?.sessionCapabilities?.resume !== undefined;
      this.supportsImages = initResult?.agentCapabilities?.promptCapabilities?.image === true;

      const version = initResult?.agentInfo?.version;
      const name = initResult?.agentInfo?.name ?? "Kimi Code CLI";
      this.fireMeta({ agentVersion: version ? `${name} ${version}` : name });

      const configOptions = await this.setupSession();
      const modelConfig = parseModelConfig(configOptions);
      if (modelConfig) this.fireModels(modelConfig);

      // Apply the permission posture via ACP session modes. Only attempt a
      // mode the agent actually offers (configOptions `mode` entry); an
      // unknown/missing offer degrades to the agent's default mode.
      const acpMode = mapPermissionModeToAcp(this.permissionMode);
      const modeOption = configOptions?.find((o) => o.id === "mode");
      if (modeOption && modeOption.currentValue !== acpMode) {
        if (modeOption.options?.some((o) => o.value === acpMode)) {
          try {
            await this.transport.call("session/set_mode", {
              sessionId: this.acpSessionId,
              modeId: acpMode,
            });
          } catch (err) {
            console.warn(`[kimi-adapter ${this.sessionId}] session/set_mode "${acpMode}" failed:`, err);
          }
        } else {
          console.warn(
            `[kimi-adapter ${this.sessionId}] agent offers no "${acpMode}" mode — staying on "${modeOption.currentValue}"`,
          );
        }
      }

      // Apply the launch-time model choice, then re-announce so the UI shows
      // the actually-selected model.
      if (this.launchModel && modelConfig && this.launchModel !== modelConfig.current) {
        try {
          await this.setModel(this.launchModel);
          this.fireModels({ ...modelConfig, current: this.launchModel });
        } catch (err) {
          console.warn(`[kimi-adapter ${this.sessionId}] launch model "${this.launchModel}" not applied:`, err);
        }
      }

      void this.drainPromptQueue();
    } catch (err) {
      const message = `Kimi ACP initialization failed: ${err instanceof Error ? err.message : err}`;
      console.error(`[kimi-adapter ${this.sessionId}] ${message}`);
      this.initFailed = true;
      this.promptQueue.length = 0;
      this.fireError(message);
      this.fireDisconnect();
    }
  }

  /**
   * `session/resume` when resuming (verified: replays NO history — Pneuma
   * rehydrates chat from its own history.json; `session/load` is avoided
   * precisely because it replays the full conversation as update frames).
   * Falls back to a fresh `session/new` when resume is unsupported or the
   * old session is gone.
   */
  private async setupSession(): Promise<AcpConfigOption[] | undefined> {
    if (this.resumeSessionId && this.supportsResume) {
      try {
        const result = (await this.transport.call("session/resume", {
          sessionId: this.resumeSessionId,
          cwd: this.cwd,
        })) as { configOptions?: AcpConfigOption[] };
        this.setAcpSessionId(this.resumeSessionId);
        return result?.configOptions;
      } catch (err) {
        console.warn(
          `[kimi-adapter ${this.sessionId}] session/resume failed (${err}); starting a new session`,
        );
        this.resumeSessionId = undefined;
      }
    }
    const result = (await this.transport.call("session/new", {
      cwd: this.cwd,
      mcpServers: [],
    })) as { sessionId?: string; configOptions?: AcpConfigOption[] };
    if (!result?.sessionId) {
      throw new Error("session/new returned no sessionId");
    }
    this.setAcpSessionId(result.sessionId);
    return result.configOptions;
  }

  private setAcpSessionId(id: string): void {
    this.acpSessionId = id;
    if (id === this.lastEmittedSessionId) return;
    this.lastEmittedSessionId = id;
    for (const handler of this.sessionIdHandlers) {
      try {
        handler(id);
      } catch (err) {
        console.error(`[kimi-adapter ${this.sessionId}] sessionId handler error:`, err);
      }
    }
  }

  // ── Prompt queue ───────────────────────────────────────────────────────────

  private async drainPromptQueue(): Promise<void> {
    if (this.promptInFlight || this.disconnected || this.initFailed) return;
    if (!this.acpSessionId) return; // handshake still running — drained on completion
    const next = this.promptQueue.shift();
    if (!next) return;

    this.promptInFlight = true;
    try {
      // No timeout: session/prompt resolves only at end of turn, and a turn
      // legitimately blocks on human permission answers. Transport close
      // still rejects the call, so a dead process can't leak the promise.
      const result = (await this.transport.call(
        "session/prompt",
        { sessionId: this.acpSessionId, prompt: next.prompt },
        null,
      )) as AcpPromptResult;
      this.finishTurn({ stopReason: result?.stopReason ?? "end_turn", isError: false });
    } catch (err) {
      const message = `Kimi turn failed: ${err instanceof Error ? err.message : err}`;
      console.error(`[kimi-adapter ${this.sessionId}] ${message}`);
      this.fireError(message);
      this.finishTurn({ stopReason: "error", isError: true });
    } finally {
      this.promptInFlight = false;
      void this.drainPromptQueue();
    }
  }

  private finishTurn(end: KimiTurnEnd): void {
    // Flush any buffered text/thinking the turn ended on.
    this.dispatchEvents(this.translator.endTurn());
    for (const handler of this.turnEndedHandlers) {
      try {
        handler(end);
      } catch (err) {
        console.error(`[kimi-adapter ${this.sessionId}] turnEnded handler error:`, err);
      }
    }
  }

  // ── Inbound dispatch ───────────────────────────────────────────────────────

  private onNotification(method: string, params: Record<string, unknown>): void {
    if (method === "session/update") {
      const update = (params as { update?: Record<string, unknown> }).update;
      if (!update) return;
      this.dispatchEvents(this.translator.translate(update));
      return;
    }
    // Other notifications are informational — nothing to route today.
  }

  private onRequest(method: string, id: number, params: Record<string, unknown>): void {
    if (method === "session/request_permission") {
      this.onPermissionRequestFrame(id, params as unknown as AcpPermissionRequestParams);
      return;
    }
    // Unknown agent→client request: refuse explicitly rather than deadlock
    // the turn or silently grant anything.
    console.warn(`[kimi-adapter ${this.sessionId}] unknown agent request "${method}" — refusing`);
    this.transport.respond(id, { outcome: { outcome: "cancelled" } });
  }

  private onPermissionRequestFrame(rpcId: number, params: AcpPermissionRequestParams): void {
    const requestId = randomUUID();
    const optionIdByBehavior: PendingPermission["optionIdByBehavior"] = {
      allow: params.options?.find((o) => o.kind === "allow_once")?.optionId,
      allowAlways: params.options?.find((o) => o.kind === "allow_always")?.optionId,
      deny: params.options?.find((o) => o.kind === "reject_once" || o.kind === "reject_always")?.optionId,
    };
    this.pendingPermissions.set(requestId, { rpcId, optionIdByBehavior });

    const toolCallId = params.toolCall?.toolCallId ?? "";
    const description = (params.toolCall?.content ?? [])
      .map((c) => (c?.content?.type === "text" ? c.content.text : ""))
      .join(" ")
      .trim();
    const req: KimiPermissionRequest = {
      requestId,
      // The request's `title` is the tool name at request time; the
      // translator's record (from the tool_call start frame) is authoritative.
      toolName: this.translator.toolName(toolCallId) ?? params.toolCall?.title ?? "tool",
      toolUseId: toolCallId || requestId,
      description,
    };
    for (const handler of this.permissionRequestHandlers) {
      try {
        handler(req);
      } catch (err) {
        console.error(`[kimi-adapter ${this.sessionId}] permissionRequest handler error:`, err);
      }
    }
  }

  private cancelPendingPermissions(outcome: "cancelled"): void {
    for (const [requestId, pending] of this.pendingPermissions) {
      try {
        this.transport.respond(pending.rpcId, { outcome: { outcome } });
      } catch {}
      for (const handler of this.permissionCancelledHandlers) {
        try {
          handler(requestId);
        } catch {}
      }
    }
    this.pendingPermissions.clear();
  }

  private dispatchEvents(events: ReturnType<AcpSessionTranslator["translate"]>): void {
    for (const event of events) {
      switch (event.kind) {
        case "message":
          for (const handler of this.messageHandlers) {
            try {
              handler(event.message);
            } catch (err) {
              console.error(`[kimi-adapter ${this.sessionId}] message handler error:`, err);
            }
          }
          break;
        case "delta":
          for (const handler of this.streamDeltaHandlers) {
            try {
              handler({ deltaType: event.deltaType, text: event.text });
            } catch (err) {
              console.error(`[kimi-adapter ${this.sessionId}] delta handler error:`, err);
            }
          }
          break;
        case "commands":
          for (const handler of this.commandsHandlers) {
            try {
              handler(event.commands);
            } catch (err) {
              console.error(`[kimi-adapter ${this.sessionId}] commands handler error:`, err);
            }
          }
          break;
        case "tool-progress":
          for (const handler of this.toolProgressHandlers) {
            try {
              handler({ toolCallId: event.toolCallId, toolName: event.toolName });
            } catch (err) {
              console.error(`[kimi-adapter ${this.sessionId}] toolProgress handler error:`, err);
            }
          }
          break;
        case "unknown":
          if (!this.warnedUnknownKinds.has(event.sessionUpdate)) {
            this.warnedUnknownKinds.add(event.sessionUpdate);
            console.warn(`[kimi-adapter ${this.sessionId}] unknown sessionUpdate kind "${event.sessionUpdate}"`);
          }
          break;
      }
    }
  }

  // ── Meta / error / disconnect fan-out ──────────────────────────────────────

  private fireMeta(meta: { agentVersion: string }): void {
    for (const handler of this.metaHandlers) {
      try {
        handler(meta);
      } catch (err) {
        console.error(`[kimi-adapter ${this.sessionId}] meta handler error:`, err);
      }
    }
  }

  private fireModels(models: KimiModelInfo): void {
    for (const handler of this.modelsHandlers) {
      try {
        handler(models);
      } catch (err) {
        console.error(`[kimi-adapter ${this.sessionId}] models handler error:`, err);
      }
    }
  }

  private fireError(message: string): void {
    for (const handler of this.errorHandlers) {
      try {
        handler(message);
      } catch {}
    }
  }

  private fireDisconnect(): void {
    if (this.disconnected) return;
    this.disconnected = true;
    this.cancelPendingPermissions("cancelled");
    this.fireDisconnectHandlers();
  }

  private fireDisconnectHandlers(): void {
    const handlers = this.disconnectHandlers.splice(0);
    for (const handler of handlers) {
      try {
        handler();
      } catch {}
    }
  }
}
