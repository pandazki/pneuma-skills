/**
 * Core type exports — Pneuma Skills v1.0 契约层
 *
 * 三层契约:
 * - Layer 4: ModeManifest + ModeDefinition (能力描述协议)
 * - Layer 3: ViewerContract (内容查看器契约)
 * - Layer 2: AgentBackend + AgentProtocolAdapter (Agent 通信抽象)
 */

export type {
  ModeManifest,
  SkillConfig,
  ViewerConfig,
  AgentPreferences,
  InitConfig,
  ViewerApiConfig,
} from "./mode-manifest.js";

export type {
  ViewerContract,
  ViewerPreviewProps,
  ViewerFileContent,
  ViewerSelectionContext,
  WorkspaceItem,
  FileWorkspaceModel,
  ViewerActionParam,
  ViewerActionDescriptor,
  ViewerActionRequest,
  ViewerActionResult,
} from "./viewer-contract.js";

export type { ModeDefinition } from "./mode-definition.js";

export type {
  AgentBackend,
  AgentSessionInfo,
  AgentLaunchOptions,
  AgentCapabilities,
  AgentProtocolAdapter,
} from "./agent-backend.js";
