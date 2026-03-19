/**
 * Core type exports — Pneuma Skills v1.0 contract layer
 *
 * Three-layer contracts:
 * - Layer 4: ModeManifest + ModeDefinition (capability declaration protocol)
 * - Layer 3: ViewerContract (content viewer contract)
 * - Layer 2: AgentBackend + AgentProtocolAdapter (Agent communication abstraction)
 */

export type {
  ModeManifest,
  SkillConfig,
  ViewerConfig,
  AgentPreferences,
  InitConfig,
  ViewerApiConfig,
  EvolutionConfig,
  EvolutionTool,
} from "./mode-manifest.js";

export type {
  ViewerContract,
  ViewerPreviewProps,
  ViewerFileContent,
  ViewerSelectionContext,
  WorkspaceItem,
  FileWorkspaceModel,
  ContentSetTraits,
  ContentSet,
  ViewerActionParam,
  ViewerActionDescriptor,
  ViewerActionRequest,
  ViewerActionResult,
  ViewerCommandDescriptor,
  ViewerLocator,
} from "./viewer-contract.js";

export type { ModeDefinition } from "./mode-definition.js";

export type {
  AgentBackend,
  AgentSessionInfo,
  AgentLaunchOptions,
  AgentCapabilities,
  AgentProtocolAdapter,
} from "./agent-backend.js";
