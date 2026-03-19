/**
 * ClaudeCodeBackend — Claude Code implementation of AgentBackend.
 *
 * Wraps CliLauncher and implements the standard AgentBackend interface.
 * Uses the Claude Code protocol as the source of truth.
 */

import type {
  AgentBackend,
  AgentSessionInfo,
  AgentLaunchOptions,
  AgentCapabilities,
} from "../../core/types/agent-backend.js";
import { CliLauncher } from "./cli-launcher.js";
import type { SdkSessionInfo, LaunchOptions } from "./cli-launcher.js";

export class ClaudeCodeBackend implements AgentBackend {
  readonly name = "claude-code" as const;

  readonly capabilities: AgentCapabilities = {
    streaming: true,
    resume: true,
    permissions: true,
    toolProgress: true,
    modelSwitch: true,
  };

  private launcher: CliLauncher;

  constructor(port: number) {
    this.launcher = new CliLauncher(port);
  }

  launch(options: AgentLaunchOptions): AgentSessionInfo {
    const launchOpts: LaunchOptions = {
      cwd: options.cwd,
      permissionMode: options.permissionMode,
      model: options.model,
      sessionId: options.sessionId,
      resumeSessionId: options.resumeSessionId,
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
    this.launcher.setCLISessionId(sessionId, agentSessionId);
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

  /** SdkSessionInfo → AgentSessionInfo mapping */
  private toAgentSessionInfo(info: SdkSessionInfo): AgentSessionInfo {
    return {
      sessionId: info.sessionId,
      agentSessionId: info.cliSessionId,
      pid: info.pid,
      state: info.state,
      exitCode: info.exitCode,
      cwd: info.cwd,
      createdAt: info.createdAt,
    };
  }
}
