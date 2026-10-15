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
  ProxyRoute,
} from "./mode-manifest.js";

export type {
  ViewerContract,
  ViewerPreviewProps,
  ViewerFileContent,
  ViewerSelectionContext,
  ViewerAddress,
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
export type { ModeInfo, ModeViewerBuildState } from "./mode-viewer.js";
export { modeViewerAssetUrl } from "./mode-viewer.js";
export type {
  CollaborationJsonValue, CollaborationJsonObject, ViewerCollaborationDeclaration,
  ViewerViewState, ViewerProjection, ViewerCollaborationAdapter,
  ViewerCollaborationBinding, ViewerPermissions,
} from "./viewer-collaboration.js";
export { isCollaborationJson, isViewerViewState } from "./viewer-collaboration.js";
export type {
  CollaborationPublicationProjection, CollaborationViewerCompatibility,
  ModePublicationInput, ModePublicationOutput, ModePublicationAdapter,
} from "./collaboration-publication.js";

export type {
  AgentBackend,
  AgentSessionInfo,
  AgentLaunchOptions,
  AgentCapabilities,
  AgentProtocolAdapter,
} from "./agent-backend.js";

export type {
  PluginManifest,
  HookName,
  SlotName,
  SlotDeclaration,
  FormSlotDeclaration,
  FormField,
  SettingField,
  SessionInfo,
  HookContext,
  HookHandler,
  PluginRouteContext,
  DeployBinding,
  LoadedPlugin,
  PluginSettingsEntry,
  PluginSettings,
  MemoryEntry,
  MemorySearchResult,
  MemorySource,
} from "./plugin.js";

export type {
  Source,
  SourceEvent,
  SourceProvider,
  SourceContext,
  FileChannel,
  FileChangeEvent,
  SourceDescriptor,
} from "./source.js";

export type { ProjectManifest, ProjectSummary } from "./project-manifest.js";
export { isProjectManifest } from "./project-manifest.js";
export type {
  CollaborationWorkspace, CollaborationAuthority, LocalCollaborationBinding, LocalCollaborationRoom,
} from "./collaboration-workspace.js";
export { collaborationAuthorityBase } from "./collaboration-workspace.js";

export type {
  CollaborationRole, CollaborationMember, CollaborationIdentity,
  CollaborationRoom, CollaborationProjectState, CollaborationView,
  CollaborationPresence, CollaborationAnchor, CollaborationCommentPreview, CollaborationCommentMessage,
  CollaborationComment, CollaborationChatMessage, CollaborationRoomState,
  CollaborationClientMessage, CollaborationServerMessage,
  CollaborationInvite, CollaborationGuestLink,
} from "./collaboration.js";
export { canWriteCollaboration, canDiscussCollaboration, canManageCollaborationRoom, isCollaborationHost } from "./collaboration.js";

export type {
  BorrowDispatchPayload,
  BorrowResult,
  BorrowLink,
  BorrowScope,
  BorrowState,
  BorrowResultStatus,
  BorrowProducedArtifact,
  BorrowReturnVia,
} from "./borrow.js";
export { isBorrowResult, normalizeBorrowScope, MAX_CONCURRENT_BORROWS_PER_SESSION } from "./borrow.js";

export type {
  LibraryManifest,
  LibraryModeEntry,
  LibrarySource,
  InstalledLibrary,
  InstalledLibraryMode,
} from "./library.js";

export type { WatcherBackendKind, WatcherHealth } from "./workspace-watcher.js";
export { WATCHER_BACKEND_KINDS, parseWatcherBackendKind } from "./workspace-watcher.js";

export * from "./collaboration-publication.js";

export type { CollaborationReference, CollaborationReferenceSource, CollaborationResolvedReference } from "./collaboration-reference.js";
export type { ImportCollaborationReference, CollaborationReferenceImportReceipt } from "./collaboration-reference-import.js";

export type { PrivateViewerCaptureParams, PrivateViewerInstanceId, PrivateViewerIncomingMessage, PrivateViewerOutgoingMessage } from "./private-viewer.js";

export { isPrivateViewerInstanceId } from "./private-viewer.js";
export type { CollaborationProjectRemovalReceipt } from "./collaboration.js";

export type { CollaborationAuthorityIdentity } from "./collaboration-workspace.js";
export { collaborationIdentityChallenge, collaborationReferenceOperationAuthority } from "./collaboration-workspace.js";

export type { CollaborationTunnelProvider, CollaborationInternetAccessPhase, CollaborationInternetAccessState, CollaborationInternetAccessChange } from "./collaboration-access.js";
export { COLLABORATION_PUBLIC_IDLE_MS, parseCollaborationTunnelProvider } from "./collaboration-access.js";

export type { CollaborationSetupStatus } from "./collaboration-setup.js";
