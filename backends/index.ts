import type {
  AgentBackend,
  AgentBackendDescriptor,
  AgentCapabilities,
  AgentBackendType,
} from "../core/types/agent-backend.js";
import { ClaudeCodeBackend } from "./claude-code/index.js";

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
    implemented: false,
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
    streaming: false,
    resume: false,
    permissions: false,
    toolProgress: false,
    modelSwitch: false,
  },
};

export function getBackendDescriptors(): AgentBackendDescriptor[] {
  return BACKEND_DESCRIPTORS;
}

export function getImplementedBackends(): AgentBackendDescriptor[] {
  return BACKEND_DESCRIPTORS.filter((backend) => backend.implemented);
}

export function getDefaultBackendType(): AgentBackendType {
  return "claude-code";
}

export function getBackendCapabilities(type: AgentBackendType): AgentCapabilities {
  return BACKEND_CAPABILITIES[type];
}

export function createBackend(type: AgentBackendType, port: number): AgentBackend {
  switch (type) {
    case "claude-code":
      return new ClaudeCodeBackend(port);
    case "codex":
      throw new Error("Codex backend is not implemented yet.");
  }
}
