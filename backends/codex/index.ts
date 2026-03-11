/**
 * CodexBackend — AgentBackend implementation for OpenAI Codex CLI.
 *
 * Wraps CodexCliLauncher, implements the standard AgentBackend interface.
 * Uses stdio JSON-RPC transport (not WebSocket) to communicate with Codex app-server.
 */

import type {
  AgentBackend,
  AgentSessionInfo,
  AgentLaunchOptions,
  AgentCapabilities,
} from "../../core/types/agent-backend.js";
import { CodexCliLauncher } from "./cli-launcher.js";
import type { CodexSessionInfo, CodexLaunchOptions } from "./cli-launcher.js";
import type { CodexAdapter } from "./codex-adapter.js";

export class CodexBackend implements AgentBackend {
  readonly name = "codex" as const;

  readonly capabilities: AgentCapabilities = {
    streaming: true,
    resume: true,
    permissions: true,
    toolProgress: false,
    modelSwitch: true,
  };

  private launcher: CodexCliLauncher;

  constructor() {
    this.launcher = new CodexCliLauncher();
  }

  launch(options: AgentLaunchOptions): AgentSessionInfo {
    const launchOpts: CodexLaunchOptions = {
      cwd: options.cwd,
      permissionMode: options.permissionMode,
      model: options.model,
      sessionId: options.sessionId,
      resumeThreadId: options.resumeSessionId,
      env: options.env,
    };

    const info = this.launcher.launch(launchOpts);
    return this.toAgentSessionInfo(info);
  }

  getSession(sessionId: string): AgentSessionInfo | undefined {
    const info = this.launcher.getSession(sessionId);
    return info ? this.toAgentSessionInfo(info) : undefined;
  }

  isAlive(sessionId: string): boolean {
    return this.launcher.isAlive(sessionId);
  }

  markConnected(sessionId: string): void {
    this.launcher.markConnected(sessionId);
  }

  setAgentSessionId(sessionId: string, agentSessionId: string): void {
    this.launcher.setThreadId(sessionId, agentSessionId);
  }

  async kill(sessionId: string): Promise<boolean> {
    return this.launcher.kill(sessionId);
  }

  async killAll(): Promise<void> {
    return this.launcher.killAll();
  }

  onSessionExited(cb: (sessionId: string, exitCode: number | null) => void): void {
    this.launcher.onSessionExited(cb);
  }

  /** Register a callback for when a CodexAdapter is created (WsBridge needs to attach it). */
  onAdapterCreated(cb: (sessionId: string, adapter: CodexAdapter) => void): void {
    this.launcher.onAdapterCreated(cb);
  }

  /** Get the CodexAdapter for a session (for WsBridge integration). */
  getAdapter(sessionId: string): CodexAdapter | undefined {
    return this.launcher.getAdapter(sessionId);
  }

  private toAgentSessionInfo(info: CodexSessionInfo): AgentSessionInfo {
    return {
      sessionId: info.sessionId,
      agentSessionId: info.threadId,
      pid: info.pid,
      state: info.state,
      exitCode: info.exitCode,
      cwd: info.cwd,
      createdAt: info.createdAt,
    };
  }
}
