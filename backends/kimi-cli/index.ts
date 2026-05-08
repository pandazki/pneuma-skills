/**
 * KimiCliBackend — AgentBackend for Moonshot AI's Kimi CLI.
 *
 * Wraps KimiCliLauncher; uses stdio NDJSON (kimi --print --input-format stream-json
 * --output-format stream-json). Pattern mirrors CodexBackend in backends/codex/index.ts.
 */

import type {
  AgentBackend,
  AgentSessionInfo,
  AgentLaunchOptions,
  AgentCapabilities,
} from "../../core/types/agent-backend.js";
import { KimiCliLauncher } from "./cli-launcher.js";
import type { KimiSessionInfo, KimiLaunchOptions } from "./cli-launcher.js";
import type { KimiAdapter } from "./kimi-adapter.js";

export class KimiCliBackend implements AgentBackend {
  readonly name = "kimi-cli" as const;

  readonly capabilities: AgentCapabilities = {
    streaming: true,
    resume: true,
    permissions: false,
    toolProgress: false,
    modelSwitch: true,
  };

  private launcher: KimiCliLauncher;

  constructor() {
    this.launcher = new KimiCliLauncher();
  }

  launch(options: AgentLaunchOptions): AgentSessionInfo {
    const launchOpts: KimiLaunchOptions = {
      cwd: options.cwd,
      model: options.model,
      sessionId: options.sessionId,
      resumeKimiSessionId: options.resumeSessionId,
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
    this.launcher.setKimiSessionId(sessionId, agentSessionId);
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

  /** Bridge integration hooks (mirrors CodexBackend.onAdapterCreated / getAdapter). */
  onAdapterCreated(cb: (sessionId: string, adapter: KimiAdapter) => void): void {
    this.launcher.onAdapterCreated(cb);
  }

  getAdapter(sessionId: string): KimiAdapter | undefined {
    return this.launcher.getAdapter(sessionId);
  }

  private toAgentSessionInfo(info: KimiSessionInfo): AgentSessionInfo {
    return {
      sessionId: info.sessionId,
      agentSessionId: info.kimiSessionId,
      pid: info.pid,
      state: info.state,
      exitCode: info.exitCode,
      cwd: info.cwd,
      createdAt: info.createdAt,
    };
  }
}
