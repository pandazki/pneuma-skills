import type { StateCreator } from "zustand";
import type { AppState } from "./types.js";

/**
 * Handoff frontmatter structure matches `server/handoff-watcher.ts`
 * (HandoffFrontmatter). Kept loose here because the slice only forwards
 * data — no parsing or normalization on the browser side.
 */
export interface HandoffFrontmatter {
  handoff_id: string;
  target_mode: string;
  target_session?: string;
  source_session?: string;
  source_mode?: string;
  source_display_name?: string;
  intent?: string;
  suggested_files?: string[];
  created_at?: string;
}

export interface HandoffData {
  path: string;
  frontmatter: HandoffFrontmatter;
  body: string;
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

export interface ProjectSlice {
  projectContext: ProjectContext | null;
  /** Pending handoffs keyed by `frontmatter.handoff_id`. */
  handoffInbox: Map<string, HandoffData>;
  setProjectContext: (ctx: ProjectContext | null) => void;
  recordHandoffCreated: (h: HandoffData) => void;
  recordHandoffDeleted: (handoffId: string) => void;
  clearHandoffs: () => void;
}

export const createProjectSlice: StateCreator<AppState, [], [], ProjectSlice> = (set) => ({
  projectContext: null,
  handoffInbox: new Map(),
  setProjectContext: (ctx) => set({ projectContext: ctx }),
  recordHandoffCreated: (h) =>
    set((s) => {
      const next = new Map(s.handoffInbox);
      next.set(h.frontmatter.handoff_id, h);
      return { handoffInbox: next };
    }),
  recordHandoffDeleted: (id) =>
    set((s) => {
      if (!s.handoffInbox.has(id)) return s;
      const next = new Map(s.handoffInbox);
      next.delete(id);
      return { handoffInbox: next };
    }),
  clearHandoffs: () => set({ handoffInbox: new Map() }),
});
