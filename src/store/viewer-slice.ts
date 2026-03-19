import type { StateCreator } from "zustand";
import type { Annotation, UserAction } from "../types.js";
import type { ViewerActionRequest, ViewerLocator } from "../../core/types/viewer-contract.js";
import type { AppState, ElementSelection } from "./types.js";

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
  pendingViewerNotification: { type: string; message: string; severity: "info" | "warning"; summary?: string } | null;
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
  setNavigateRequest: (req: ViewerLocator | null) => void;
  setPendingViewerNotification: (n: { type: string; message: string; severity: "info" | "warning" } | null) => void;
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
  pendingViewerNotification: null,
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
    if (!navigateRequest) {
      set({ navigateRequest: null });
      return;
    }
    const { data } = navigateRequest;
    if (data.contentSet) {
      const targetSet = data.contentSet as string;
      const state = get();
      const needsSwitch = state.activeContentSet !== targetSet;
      if (needsSwitch && state.contentSets.some((cs) => cs.prefix === targetSet)) {
        state.setActiveContentSet(targetSet);
      }
      const { contentSet: _, ...rest } = data;
      if (typeof rest.file === "string" && rest.file.startsWith(targetSet + "/")) {
        rest.file = rest.file.slice(targetSet.length + 1);
      }
      if (Object.keys(rest).length > 0) {
        if (needsSwitch) {
          setTimeout(() => {
            set({ navigateRequest: { label: navigateRequest.label, data: rest } });
          }, 50);
        } else {
          set({ navigateRequest: { label: navigateRequest.label, data: rest } });
        }
      }
    } else {
      const state = get();
      const filePath = typeof data.file === "string" ? data.file : null;
      if (filePath && state.contentSets.length > 0) {
        const matchedCS = state.contentSets.find((cs) => filePath.startsWith(cs.prefix + "/"));
        if (matchedCS) {
          const needsSwitch = state.activeContentSet !== matchedCS.prefix;
          if (needsSwitch) {
            state.setActiveContentSet(matchedCS.prefix);
          }
          const stripped = { ...data, file: filePath.slice(matchedCS.prefix.length + 1) };
          if (needsSwitch) {
            setTimeout(() => {
              set({ navigateRequest: { label: navigateRequest.label, data: stripped } });
            }, 50);
          } else {
            set({ navigateRequest: { label: navigateRequest.label, data: stripped } });
          }
          return;
        }
      }
      set({ navigateRequest });
    }
  },

  setPendingViewerNotification: (n) => set({ pendingViewerNotification: n }),

  pushUserAction: (action) => set((s) => ({ userActions: [...s.userActions, action] })),
  drainUserActions: (): UserAction[] => {
    const actions = get().userActions;
    set({ userActions: [] });
    return actions;
  },
});
