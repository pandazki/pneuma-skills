import type { BackendModule } from "../../core/types/agent-backend.js";
import { resolveBinary } from "../../server/path-resolver.js";
import { defaultToolFileRef } from "../tool-file-ref.js";
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
  // Claude Code reports `<cwd>/.claude/commands/*.md` as native slash_commands,
  // so session-scoped commands (e.g. `/borrow`) install here. Codex/Kimi leave
  // this undefined — they don't surface project command files.
  commandsDir: ".claude/commands",

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

  // Fallback only. The live list comes from the CLI's `initialize` control
  // response (see WsBridge.requestSupportedModels) and supersedes this as soon
  // as the transport attaches; these entries only surface on a CLI too old to
  // answer. Deliberately aliases rather than pinned ids — an alias tracks
  // whatever the installed CLI considers current, so this list cannot go stale
  // the way the old pinned trio did (it still said Opus 4.7 / Sonnet 4.6 long
  // after Opus 5 and Fable shipped).
  defaultModels: [
    { id: "opus", label: "Opus", icon: "O" },
    { id: "sonnet", label: "Sonnet", icon: "S" },
    { id: "haiku", label: "Haiku", icon: "H" },
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

  toolFileRef: defaultToolFileRef,
};
