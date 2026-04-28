import type {
  AgentBackend,
  AgentBackendDescriptor,
  AgentCapabilities,
  AgentBackendType,
} from "../core/types/agent-backend.js";
import { ClaudeCodeBackend } from "./claude-code/index.js";
import {
  CLAUDE_CODE_BREAK_VERSION,
  isClaudeCodeCompatible,
  probeClaudeCodeVersion,
} from "./claude-code/version.js";
import { CodexBackend } from "./codex/index.js";
import { resolveBinary } from "../server/path-resolver.js";

const BACKEND_DESCRIPTORS: AgentBackendDescriptor[] = [
  {
    type: "claude-code",
    label: "Claude Code",
    description: "Anthropic Claude Code CLI via --sdk-url WebSocket transport.",
    implemented: true,
  },
  {
    type: "codex",
    label: "Codex",
    description: "OpenAI Codex CLI via app-server transport.",
    implemented: true,
  },
];

const BACKEND_CAPABILITIES: Record<AgentBackendType, AgentCapabilities> = {
  "claude-code": {
    streaming: true,
    resume: true,
    permissions: true,
    toolProgress: true,
    modelSwitch: true,
  },
  codex: {
    streaming: true,
    resume: true,
    permissions: true,
    toolProgress: false,
    modelSwitch: true,
  },
};

export function getBackendDescriptors(): AgentBackendDescriptor[] {
  return BACKEND_DESCRIPTORS;
}

export function getImplementedBackends(): AgentBackendDescriptor[] {
  return BACKEND_DESCRIPTORS.filter((backend) => backend.implemented);
}

export function getDefaultBackendType(): AgentBackendType {
  // Codex is preferred today: Anthropic removed Claude Code's `--sdk-url`
  // hidden flag in CC 2.1.118 (the transport Pneuma's claude-code backend
  // bridges through), so any user on a current CC will see that option
  // disabled. Defaulting to codex keeps the happy path working for new
  // sessions without forcing the user to reach for the picker.
  return "codex";
}

export function getBackendCapabilities(type: AgentBackendType): AgentCapabilities {
  return BACKEND_CAPABILITIES[type];
}

/** Binary name each backend requires on the system PATH. */
const BACKEND_BINARIES: Record<AgentBackendType, string> = {
  "claude-code": "claude",
  codex: "codex",
};

export interface BackendAvailability {
  type: AgentBackendType;
  available: boolean;
  binaryPath?: string;
  reason?: string;
}

/**
 * Detect which backends have their CLI binary available on the system.
 * Results are NOT cached — call sparingly (shell PATH probe is ~50ms each).
 */
export function detectBackendAvailability(): BackendAvailability[] {
  return BACKEND_DESCRIPTORS.map((desc) => {
    if (!desc.implemented) {
      return { type: desc.type, available: false, reason: "Not yet implemented" };
    }
    const binary = BACKEND_BINARIES[desc.type];
    const resolved = resolveBinary(binary);
    if (!resolved) {
      return {
        type: desc.type,
        available: false,
        reason: `"${binary}" CLI not found in PATH`,
      };
    }
    if (desc.type === "claude-code") {
      // CC ≥ 2.1.118 dropped the `--sdk-url` hidden transport this backend
      // bridges through, so the binary being on PATH is no longer enough.
      // Probe the version and disable with an explanation instead of
      // letting the user start a session that would never connect.
      const version = probeClaudeCodeVersion(resolved);
      if (!isClaudeCodeCompatible(version)) {
        return {
          type: desc.type,
          available: false,
          binaryPath: resolved,
          reason: `Claude Code v${version} removed --sdk-url (Pneuma needs < ${CLAUDE_CODE_BREAK_VERSION}). Disabled until the new transport lands; pick Codex for now or downgrade.`,
        };
      }
    }
    return { type: desc.type, available: true, binaryPath: resolved };
  });
}

export function createBackend(type: AgentBackendType, port: number): AgentBackend {
  switch (type) {
    case "claude-code":
      return new ClaudeCodeBackend(port);
    case "codex":
      return new CodexBackend();
  }
}
