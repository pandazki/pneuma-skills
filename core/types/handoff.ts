import type { AgentBackendType } from "./agent-backend.js";

/** User-owned settings captured before the source agent prepares a handoff brief. */
export interface HandoffRequestInput {
  source_session_id: string;
  target_mode: string;
  intent: string;
  target_backend: AgentBackendType;
}

/** Shared review payload broadcast by the server and rendered by the handoff card. */
export interface HandoffProposalPayload {
  source_session_id?: string;
  source_mode?: string;
  source_display_name?: string;
  target_mode: string;
  target_session?: string;
  /** Captured from a user request; absent for an uncorrelated agent proposal. */
  target_backend?: AgentBackendType;
  intent: string;
  summary?: string;
  suggested_files?: string[];
  key_decisions?: string[];
  open_questions?: string[];
  /**
   * A project source gains a sibling session. A quick source hands its
   * workspace to a new session. Absent when the server could not resolve the
   * source, in which case confirmation refuses to launch.
   */
  source_kind?: "quick" | "project";
}
