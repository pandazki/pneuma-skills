import type { StateCreator } from "zustand";
import type { Annotation, UserAction } from "../types.js";
import type {
  ViewerActionRequest,
  ViewerActionResult,
  ViewerLocator,
} from "../../core/types/viewer-contract.js";
import { planNavigate } from "./navigate-plan.js";
import type { AppState, ElementSelection } from "./types.js";

/**
 * How a locator click ended. `message` is the viewer's own sentence, shown
 * verbatim (mode-authored, English, like every other `ViewerActionResult`
 * message); `code` is the shell's own refusal, which the UI translates —
 * the store must not mint user-facing copy in one language.
 */
export interface NavigateOutcome {
  seq: number;
  ok: boolean;
  message?: string;
  code?: "unknownContentSet";
  contentSet?: string;
}

export interface ViewerSlice {
  selection: ElementSelection | null;
  /** Incremented every time setSelection is called with a non-null value — used to detect genuine selection changes */
  selectionStamp: number;
  previewMode: "view" | "edit" | "select" | "annotate";
  /** Annotations collected in annotate mode */
  annotations: Annotation[];
  /** Currently viewed file path (e.g. current slide), independent of element selection */
  activeFile: string | null;
  /** Current viewport line range (Doc mode) */
  viewportRange: { file: string; startLine: number; endLine: number; heading?: string } | null;
  actionRequest: ViewerActionRequest | null;
  navigateRequest: ViewerLocator | null;
  /** Bumped once per locator dispatch — the handle a card holds so it can
   *  recognise ITS OWN verdict and ignore everyone else's. */
  navigateSeq: number;
  /** How the last dispatched navigation ended, or null while one is in
   *  flight (and after a clean arrival). Only failures are worth keeping:
   *  the card renders nothing on success. */
  navigateOutcome: NavigateOutcome | null;
  userActions: UserAction[];

  setSelection: (s: ElementSelection | null) => void;
  setPreviewMode: (mode: "view" | "edit" | "select" | "annotate") => void;
  setActiveFile: (file: string | null) => void;
  setViewportRange: (range: { file: string; startLine: number; endLine: number; heading?: string } | null) => void;
  addAnnotation: (annotation: Annotation) => void;
  removeAnnotation: (id: string) => void;
  updateAnnotationComment: (id: string, comment: string) => void;
  clearAnnotations: () => void;
  setActionRequest: (req: ViewerActionRequest | null) => void;
  /** Dispatch a navigation; returns the seq that will carry its verdict.
   *  `null` clears the in-flight request WITHOUT touching seq or outcome —
   *  it is the viewer saying "done", not a new question. */
  setNavigateRequest: (req: ViewerLocator | null) => number;
  /** The viewer's verdict on the navigation it was just handed. */
  resolveNavigate: (result?: ViewerActionResult) => void;
  pushUserAction: (action: UserAction) => void;
  drainUserActions: () => UserAction[];
}

export const createViewerSlice: StateCreator<AppState, [], [], ViewerSlice> = (set, get) => ({
  selection: null,
  selectionStamp: 0,
  previewMode: "view",
  annotations: [],
  activeFile: null,
  viewportRange: null,
  actionRequest: null,
  navigateRequest: null,
  navigateSeq: 0,
  navigateOutcome: null,
  userActions: [],

  setSelection: (selection) => set((s) => ({ selection, selectionStamp: selection ? s.selectionStamp + 1 : s.selectionStamp })),
  setPreviewMode: (previewMode) => set({
    previewMode,
    ...(previewMode !== "select" && previewMode !== "annotate" ? { selection: null } : {}),
    ...(previewMode !== "annotate" ? { annotations: [] } : {}),
  }),
  setActiveFile: (activeFile) => set({ activeFile }),
  setViewportRange: (viewportRange) => set({ viewportRange }),

  addAnnotation: (annotation) => set((s) => ({ annotations: [...s.annotations, annotation] })),
  removeAnnotation: (id) => set((s) => ({ annotations: s.annotations.filter((a) => a.id !== id) })),
  updateAnnotationComment: (id, comment) => set((s) => ({
    annotations: s.annotations.map((a) => a.id === id ? { ...a, comment } : a),
  })),
  clearAnnotations: () => set({ annotations: [] }),

  setActionRequest: (actionRequest) => set({ actionRequest }),

  setNavigateRequest: (navigateRequest) => {
    // The viewer saying "done" — not a new question, so the seq and the
    // verdict it belongs to both stand. Clearing them here would erase the
    // failure a card is about to render.
    if (!navigateRequest) {
      set({ navigateRequest: null });
      return get().navigateSeq;
    }
    const state = get();
    const seq = state.navigateSeq + 1;
    const plan = planNavigate(
      navigateRequest.address,
      state.activeContentSet,
      state.contentSets,
    );
    set({ navigateSeq: seq, navigateOutcome: null });
    if (plan.kind === "refuse") {
      set({
        navigateOutcome: {
          seq,
          ok: false,
          code: plan.code,
          contentSet: plan.contentSet,
        },
      });
      return seq;
    }
    if (plan.kind === "noop") return seq;
    if (plan.kind === "switch") {
      state.setActiveContentSet(plan.switchTo);
      return seq;
    }
    if (plan.switchTo) state.setActiveContentSet(plan.switchTo);
    const handOver = () => {
      set({
        navigateRequest: { label: navigateRequest.label, address: plan.address },
      });
    };
    // A viewer handed a set it has not mounted yet cannot resolve anything
    // inside it. Same navigation, same seq — the wait is the switch's, not
    // a second question.
    if (plan.delayed) setTimeout(handOver, 50);
    else handOver();
    return seq;
  },

  resolveNavigate: (result) => {
    const seq = get().navigateSeq;
    set({
      navigateRequest: null,
      navigateOutcome:
        result && result.success === false
          ? { seq, ok: false, message: result.message }
          : null,
    });
  },

  pushUserAction: (action) => set((s) => ({ userActions: [...s.userActions, action] })),
  drainUserActions: (): UserAction[] => {
    const actions = get().userActions;
    set({ userActions: [] });
    return actions;
  },
});
