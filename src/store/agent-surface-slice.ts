import type { StateCreator } from "zustand";
import type { AppState } from "./types.js";

/**
 * The agent conversation is a relocatable, session-scoped surface. It takes
 * one of three forms:
 *
 *   - `docked`     — a rail inside the layout (viewer shrinks to make room)
 *   - `floating`   — a draggable / resizable glass panel over the viewer
 *   - `collapsed`  — a small bubble; the viewer is full-bleed
 *
 * The agent session IS the runtime session — there is no cross-session agent —
 * so this state is per session. Only the user's *layout habit* (which form,
 * where the floating panel sits) is persisted across sessions, per-mode with a
 * global fallback (see agent-surface-persistence.ts). The conversation itself
 * never leaves the session.
 */
export type SurfaceForm = "docked" | "floating" | "collapsed";

/** Top-left position and size of the floating panel, in viewport pixels. */
export interface FloatRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AgentSurfaceSlice {
  surfaceForm: SurfaceForm;
  floatRect: FloatRect;
  /** Form to restore to when expanding from the collapsed bubble. */
  lastExpandedForm: "docked" | "floating";

  setSurfaceForm: (form: SurfaceForm) => void;
  setFloatRect: (rect: Partial<FloatRect>) => void;
  collapseSurface: () => void;
  expandSurface: () => void;
}

const FLOAT_W = 440;
const FLOAT_H = 640;
const MARGIN = 24;

/** Bottom-right default so the panel doesn't cover the viewer's top-left. */
function defaultFloatRect(): FloatRect {
  if (typeof window === "undefined") {
    return { x: MARGIN, y: MARGIN, w: FLOAT_W, h: FLOAT_H };
  }
  return {
    x: Math.max(MARGIN, window.innerWidth - FLOAT_W - MARGIN),
    y: Math.max(MARGIN, window.innerHeight - FLOAT_H - MARGIN),
    w: FLOAT_W,
    h: FLOAT_H,
  };
}

export const createAgentSurfaceSlice: StateCreator<AppState, [], [], AgentSurfaceSlice> = (set) => ({
  surfaceForm: "docked",
  floatRect: defaultFloatRect(),
  lastExpandedForm: "docked",

  setSurfaceForm: (form) =>
    set(
      form === "collapsed"
        ? { surfaceForm: form }
        : { surfaceForm: form, lastExpandedForm: form },
    ),

  setFloatRect: (rect) => set((s) => ({ floatRect: { ...s.floatRect, ...rect } })),

  collapseSurface: () => set({ surfaceForm: "collapsed" }),

  expandSurface: () => set((s) => ({ surfaceForm: s.lastExpandedForm })),
});
