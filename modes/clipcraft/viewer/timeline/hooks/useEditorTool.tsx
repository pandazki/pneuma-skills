import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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

  const setTool = useCallback((tool: ToolKind | null) => {
    setActiveTool(tool);
    if (tool === null) {
      setHoveredClipId(null);
      setHoverPx(null);
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
    }),
    [activeTool, hoveredClipId, hoverPx, setTool, setHover, cancel],
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
