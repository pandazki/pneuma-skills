import type { BackendModule } from "../../core/types/agent-backend.js";
import { resolveBinary } from "../../server/path-resolver.js";
import { ClaudeCodeBackend } from "./index.js";

const INSTALL_HINT = `Install: npm install -g @anthropic-ai/claude-code
Verify: claude --version
Docs: https://docs.anthropic.com/en/docs/claude-code/overview`;

export const claudeCodeModule: BackendModule = {
  type: "claude-code",
  label: "Claude Code",
  description: "Anthropic Claude Code CLI via stdio stream-json transport.",
  displayLabel: "claude-code",

  binary: "claude",
  installHint: INSTALL_HINT,

  skillsDir: ".claude/skills",
  instructionsFile: "CLAUDE.md",

  capabilities: {
    streaming: true,
    resume: true,
    permissions: true,
    toolProgress: true,
    modelSwitch: true,
    scheduling: true,
    costTracking: true,
    contextWindow: true,
  },

  defaultModels: [
    { id: "claude-opus-4-7", label: "Opus", icon: "O" },
    { id: "claude-sonnet-4-6", label: "Sonnet", icon: "S" },
    { id: "claude-haiku-4-5-20251001", label: "Haiku", icon: "H" },
  ],

  createBackend(port: number) {
    return new ClaudeCodeBackend(port);
  },

  /**
   * Claude Code uses the legacy stdio path on WsBridge directly
   * (see WsBridge.attachCLITransport / feedCLIMessage). It does NOT
   * implement BridgeBackend — return null and the bridge handles it.
   */
  createBridgeBackend() {
    return null;
  },

  checkRequirements() {
    const resolved = resolveBinary("claude");
    if (!resolved) {
      return { ok: false, reason: `"claude" CLI not found in PATH.\n${INSTALL_HINT}` };
    }
    return { ok: true, binaryPath: resolved };
  },
};
