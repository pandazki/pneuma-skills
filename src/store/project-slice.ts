import type { StateCreator } from "zustand";
import type { AppState } from "./types.js";

/**
 * Structured handoff payload — mirrors what `pneuma handoff` accepted on the
 * agent side and what `/api/handoffs/emit` broadcast to the source session's
 * browser. Used by the HandoffCard to render the review surface.
 */
export interface HandoffProposalPayload {
  source_session_id?: string;
  source_mode?: string;
  source_display_name?: string;
  target_mode: string;
  target_session?: string;
  intent: string;
  summary?: string;
  suggested_files?: string[];
  key_decisions?: string[];
  open_questions?: string[];
}

/**
 * One in-flight handoff proposal — at most one is held in store state at a
 * time per session (the v2 protocol supersedes earlier proposals from the
 * same source).
 */
export interface ProposedHandoff {
  handoff_id: string;
  payload: HandoffProposalPayload;
  proposed_at: number;
}

/**
 * Project context — populated when the active session belongs to a Pneuma 3.0
 * project. `null` indicates a legacy quick-session (no project surface).
 *
 * - `projectRoot` is the project directory containing `.pneuma/project.json`
 * - `homeRoot` and `sessionDir` are present only for *active* project
 *   sessions. The empty-shell state (`/?project=<root>` with no session)
 *   omits them — there is no session, so doing path math against them would
 *   be a footgun. Consumers must guard for undefined.
 */
export interface ProjectContext {
  projectRoot: string | null;
  homeRoot?: string;
  sessionDir?: string;
  projectName?: string;
  projectDescription?: string;
}

/**
 * Status flags for the HandoffCard's two action buttons. The card disables
 * its buttons during the corresponding network request — without this gate
 * a double-click would fire two confirms / cancels back-to-back.
 */
export type HandoffStatus = "idle" | "sending-confirm" | "sending-cancel";

export interface ProjectSlice {
  projectContext: ProjectContext | null;
  /**
   * The currently-pending handoff proposal for this session, if any. Set on
   * `handoff_proposed` WS event, cleared on cancel / confirm / `handoff_cancelled`
   * WS event / timeout. Only one proposal is held at a time — the server
   * supersedes earlier proposals from the same source.
   */
  proposedHandoff: ProposedHandoff | null;
  handoffStatus: HandoffStatus;
  setProjectContext: (ctx: ProjectContext | null) => void;
  setProposedHandoff: (handoff: ProposedHandoff | null) => void;
  setHandoffStatus: (status: HandoffStatus) => void;
}

export const createProjectSlice: StateCreator<AppState, [], [], ProjectSlice> = (set) => ({
  projectContext: null,
  proposedHandoff: null,
  handoffStatus: "idle",
  setProjectContext: (ctx) => set({ projectContext: ctx }),
  setProposedHandoff: (handoff) => set({ proposedHandoff: handoff }),
  setHandoffStatus: (status) => set({ handoffStatus: status }),
});
