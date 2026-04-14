import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/**
 * Editor tool mode state — Premiere/CapCut-style tools that activate
 * a hover preview on the timeline. Click a tool in the toolbar →
 * cursor changes globally, hovering a clip shows a preview overlay,
 * clicking the clip commits the action and exits the tool.
 *
 * The keyboard shortcuts (S / D / Delete / ⌘⌫) intentionally bypass
 * tool mode — they execute immediately on the currently-selected
 * clip — so power users keep the fast path.
 */
export type ToolKind = "split" | "delete" | "duplicate" | "ripple";

export interface EditorToolApi {
  activeTool: ToolKind | null;
  hoveredClipId: string | null;
  hoverPxFromClipStart: number | null;
  setTool: (tool: ToolKind | null) => void;
  setHover: (clipId: string | null, pxFromClipStart: number | null) => void;
  cancel: () => void;
  /**
   * Hover-scrub baseline: the "real" playhead position before the user
   * started moving the cursor across clips in split-tool mode. The
   * first scrub seek captures this; restoreScrubBaseline() returns it
   * (and clears the ref) so the timeline container's mouseleave can
   * seek the playback engine back to where it was.
   */
  beginScrubIfNeeded: (currentTime: number) => void;
  restoreScrubBaseline: () => number | null;
}

const EditorToolContext = createContext<EditorToolApi | null>(null);

const TOOL_CURSORS: Record<ToolKind, string> = {
  split: "col-resize",
  delete: "not-allowed",
  duplicate: "copy",
  ripple: "not-allowed",
};

export function EditorToolProvider({ children }: { children: React.ReactNode }) {
  const [activeTool, setActiveTool] = useState<ToolKind | null>(null);
  const [hoveredClipId, setHoveredClipId] = useState<string | null>(null);
  const [hoverPx, setHoverPx] = useState<number | null>(null);
  const scrubBaselineRef = useRef<number | null>(null);

  const setTool = useCallback((tool: ToolKind | null) => {
    setActiveTool(tool);
    if (tool === null) {
      setHoveredClipId(null);
      setHoverPx(null);
      scrubBaselineRef.current = null;
    }
  }, []);

  const setHover = useCallback(
    (clipId: string | null, pxFromClipStart: number | null) => {
      setHoveredClipId(clipId);
      setHoverPx(pxFromClipStart);
    },
    [],
  );

  const cancel = useCallback(() => {
    setActiveTool(null);
    setHoveredClipId(null);
    setHoverPx(null);
    scrubBaselineRef.current = null;
  }, []);

  const beginScrubIfNeeded = useCallback((currentTime: number) => {
    if (scrubBaselineRef.current === null) {
      scrubBaselineRef.current = currentTime;
    }
  }, []);

  const restoreScrubBaseline = useCallback((): number | null => {
    const t = scrubBaselineRef.current;
    scrubBaselineRef.current = null;
    return t;
  }, []);

  // Global cursor + escape handling. Body cursor avoids React reconciliation
  // races when the user moves fast across tracks.
  useEffect(() => {
    if (!activeTool) {
      document.body.style.cursor = "";
      return;
    }
    document.body.style.cursor = TOOL_CURSORS[activeTool];
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setActiveTool(null);
        setHoveredClipId(null);
        setHoverPx(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.cursor = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [activeTool]);

  const value = useMemo<EditorToolApi>(
    () => ({
      activeTool,
      hoveredClipId,
      hoverPxFromClipStart: hoverPx,
      setTool,
      setHover,
      cancel,
      beginScrubIfNeeded,
      restoreScrubBaseline,
    }),
    [
      activeTool,
      hoveredClipId,
      hoverPx,
      setTool,
      setHover,
      cancel,
      beginScrubIfNeeded,
      restoreScrubBaseline,
    ],
  );

  return (
    <EditorToolContext.Provider value={value}>{children}</EditorToolContext.Provider>
  );
}

export function useEditorTool(): EditorToolApi {
  const ctx = useContext(EditorToolContext);
  if (!ctx) {
    throw new Error("useEditorTool must be used inside <EditorToolProvider>");
  }
  return ctx;
}
