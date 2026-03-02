/**
 * DrawPreview — Draw Mode viewer component.
 *
 * Implements ViewerContract's PreviewComponent.
 * Embeds the Excalidraw React component with bidirectional sync:
 * - File changes from disk → updateScene() on the canvas
 * - User edits on canvas → save back to disk via API
 *
 * Credits:
 * - Excalidraw (https://excalidraw.com) — MIT licensed whiteboard component
 *   by the Excalidraw team. This mode wraps @excalidraw/excalidraw v0.18.x.
 */

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import type {
  ViewerPreviewProps,
  ViewerSelectionContext,
} from "../../../core/types/viewer-contract.js";
import { useStore } from "../../../src/store.js";
import { setDrawCaptureViewport } from "../pneuma-mode.js";

// Lazy-loaded Excalidraw (no SSR support)
let ExcalidrawComponent: React.ComponentType<any> | null = null;
let excalidrawLoaded = false;
let excalidrawLoadPromise: Promise<void> | null = null;

function loadExcalidraw(): Promise<void> {
  if (excalidrawLoaded) return Promise.resolve();
  if (excalidrawLoadPromise) return excalidrawLoadPromise;
  excalidrawLoadPromise = Promise.all([
    import("@excalidraw/excalidraw"),
    // @ts-ignore — CSS module import handled by Vite
    import("@excalidraw/excalidraw/index.css"),
  ]).then(([mod]) => {
    ExcalidrawComponent = mod.Excalidraw;
    excalidrawLoaded = true;
  });
  return excalidrawLoadPromise;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Parse .excalidraw JSON from files array — returns the first valid one */
function parseExcalidrawFile(
  files: ViewerPreviewProps["files"],
): { elements: any[]; appState: any; excalidrawFiles: any; filePath: string } | null {
  for (const f of files) {
    if (!f.path.endsWith(".excalidraw")) continue;
    try {
      const data = JSON.parse(f.content);
      if (data.type === "excalidraw" && Array.isArray(data.elements)) {
        return {
          elements: data.elements,
          appState: data.appState || {},
          excalidrawFiles: data.files || {},
          filePath: f.path,
        };
      }
    } catch {
      // skip invalid JSON
    }
  }
  return null;
}

function getApiBase(): string {
  if (import.meta.env.DEV) {
    return `http://${location.hostname}:${import.meta.env.VITE_API_PORT || "17007"}`;
  }
  return "";
}

/** Save file content to server */
async function saveFile(path: string, content: string): Promise<boolean> {
  try {
    const res = await fetch(`${getApiBase()}/api/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Serialize Excalidraw data to .excalidraw JSON string */
function serializeToFile(elements: any[], appState: any, files: any): string {
  const exportState: Record<string, any> = {};
  if (appState.viewBackgroundColor) exportState.viewBackgroundColor = appState.viewBackgroundColor;
  if (appState.gridSize != null) exportState.gridSize = appState.gridSize;
  if (appState.gridModeEnabled != null) exportState.gridModeEnabled = appState.gridModeEnabled;

  return JSON.stringify(
    {
      type: "excalidraw",
      version: 2,
      source: "https://excalidraw.com",
      elements: elements.filter((el: any) => !el.isDeleted),
      appState: exportState,
      files: files || {},
    },
    null,
    2,
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function DrawPreview({
  files,
  selection,
  onSelect,
  mode: previewMode,
  imageVersion,
  actionRequest,
  onActionResult,
}: ViewerPreviewProps) {
  const setPreviewMode = useStore((s) => s.setPreviewMode);

  // Handle viewer action requests from agent
  useEffect(() => {
    if (!actionRequest) return;
    onActionResult?.(actionRequest.requestId, {
      success: false,
      message: `Unknown action: ${actionRequest.actionId}`,
    });
  }, [actionRequest]);

  const [ready, setReady] = useState(excalidrawLoaded);
  const [excalidrawAPI, setExcalidrawAPI] = useState<any>(null);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    return (localStorage.getItem("pneuma-draw-theme") as "light" | "dark") || "dark";
  });

  // Track what we last saved to avoid echo from file watcher
  const lastSavedContentRef = useRef<string>("");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentFilePathRef = useRef<string>("");
  // Track if we're currently saving (to skip onChange during updateScene)
  const isUpdatingFromFileRef = useRef(false);
  // Skip redundant first updateScene — initialData already provides data to Excalidraw.
  // Calling updateScene before font initialization completes causes text to vanish.
  const isFirstSyncRef = useRef(true);

  // Load Excalidraw dynamically
  useEffect(() => {
    if (!ready) {
      loadExcalidraw().then(() => setReady(true));
    }
  }, [ready]);

  // Parse the excalidraw data from files
  const excalidrawData = useMemo(() => parseExcalidrawFile(files), [files]);

  // Track the active file
  const activeFilePath = excalidrawData?.filePath || null;
  useEffect(() => {
    currentFilePathRef.current = activeFilePath || "";
  }, [activeFilePath]);

  // Notify parent of active file
  useEffect(() => {
    if (activeFilePath) {
      onSelect?.({ type: "viewing", content: "", file: activeFilePath } as ViewerSelectionContext);
    }
  }, [activeFilePath]);

  // Build initial data for Excalidraw
  const initialData = useMemo(() => {
    if (!excalidrawData) return { elements: [], appState: { viewBackgroundColor: "#ffffff" }, files: {} };
    return {
      elements: excalidrawData.elements,
      appState: {
        ...excalidrawData.appState,
        theme,
      },
      files: excalidrawData.excalidrawFiles,
      scrollToContent: true,
    };
  // Only compute once on first render with data
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync file changes from disk into the Excalidraw canvas
  useEffect(() => {
    if (!excalidrawAPI || !excalidrawData) return;

    const newContent = serializeToFile(
      excalidrawData.elements,
      excalidrawData.appState,
      excalidrawData.excalidrawFiles,
    );

    // On the first sync after mount, skip updateScene if initialData already
    // provided the same data. Excalidraw's internal font rendering isn't ready
    // yet, and an early updateScene causes text elements to vanish.
    if (isFirstSyncRef.current) {
      isFirstSyncRef.current = false;
      if (initialData.elements.length > 0) {
        lastSavedContentRef.current = newContent;
        return;
      }
    }

    // Skip if this is our own save echoing back
    if (newContent === lastSavedContentRef.current) return;

    // Update the canvas with the file's data
    isUpdatingFromFileRef.current = true;
    try {
      excalidrawAPI.updateScene({
        elements: excalidrawData.elements,
      });
      if (excalidrawData.excalidrawFiles && Object.keys(excalidrawData.excalidrawFiles).length > 0) {
        excalidrawAPI.addFiles(Object.values(excalidrawData.excalidrawFiles));
      }
    } finally {
      // Reset after a delay to allow all onChange events from updateScene to be ignored
      setTimeout(() => {
        isUpdatingFromFileRef.current = false;
      }, 500);
    }
  }, [excalidrawAPI, excalidrawData]);

  // Track current preview mode in a ref so handleChange can read it without re-creating
  const previewModeRef = useRef(previewMode);
  previewModeRef.current = previewMode;

  // Handle changes from the Excalidraw canvas (user editing)
  const handleChange = useCallback(
    (elements: any[], appState: any, files: any) => {
      // Skip saves in view mode
      if (previewModeRef.current === "view") return;
      // Skip if we're updating from a file change (avoid echo)
      if (isUpdatingFromFileRef.current) return;
      if (!currentFilePathRef.current) return;

      // Debounce saves
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        const content = serializeToFile(elements, appState, files);
        lastSavedContentRef.current = content;
        saveFile(currentFilePathRef.current, content);
      }, 500);
    },
    [],
  );

  // Export selected elements as a screenshot (base64 PNG)
  const captureSelectedElements = useCallback(async (selectedElements: any[]): Promise<string | undefined> => {
    if (!excalidrawAPI || selectedElements.length === 0) return undefined;
    try {
      const { exportToBlob } = await import("@excalidraw/excalidraw");
      const blob = await exportToBlob({
        elements: selectedElements,
        appState: { ...excalidrawAPI.getAppState(), exportWithDarkMode: false },
        files: excalidrawAPI.getFiles(),
        maxWidthOrHeight: 600,
      });
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return `data:${blob.type};base64,${btoa(binary)}`;
    } catch {
      return undefined;
    }
  }, [excalidrawAPI]);

  // Handle element selection for agent context
  const handlePointerUp = useCallback(() => {
    if (previewMode !== "select" || !excalidrawAPI) return;

    const appState = excalidrawAPI.getAppState();
    const selectedIds = appState.selectedElementIds || {};
    const selectedIdList = Object.keys(selectedIds).filter((id) => selectedIds[id]);

    if (selectedIdList.length === 0) {
      onSelect(null);
      return;
    }

    const elements = excalidrawAPI.getSceneElements();
    const selectedElements = elements.filter((el: any) => selectedIdList.includes(el.id));

    if (selectedElements.length === 0) {
      onSelect(null);
      return;
    }

    // Build a description of the selected elements
    const descriptions = selectedElements.map((el: any) => {
      let desc = el.type;
      if (el.type === "text") {
        desc = `text "${el.text}"`;
      } else if (el.boundElements) {
        const textBound = el.boundElements.find((b: any) => b.type === "text");
        if (textBound) {
          const textEl = elements.find((e: any) => e.id === textBound.id);
          if (textEl) desc = `${el.type} "${textEl.text}"`;
        }
      }
      return desc;
    });

    const content = descriptions.join(", ");

    // Expand selection to include bound text elements (e.g. text inside a rectangle)
    const selectedIdSet = new Set(selectedElements.map((el: any) => el.id));
    for (const el of selectedElements) {
      if (el.boundElements) {
        for (const bound of el.boundElements) {
          if (bound.type === "text" && !selectedIdSet.has(bound.id)) {
            const boundEl = elements.find((e: any) => e.id === bound.id);
            if (boundEl) {
              selectedIdSet.add(bound.id);
              selectedElements.push(boundEl);
            }
          }
        }
      }
    }

    // Capture screenshot of selected elements, then fire onSelect with thumbnail
    captureSelectedElements(selectedElements).then((thumbnail) => {
      onSelect({
        type: selectedElements.length === 1 ? selectedElements[0].type : "group",
        content,
        file: currentFilePathRef.current,
        thumbnail,
      });
    });
  }, [previewMode, excalidrawAPI, onSelect, captureSelectedElements]);

  // Register captureViewport for the draw mode contract
  useEffect(() => {
    if (!excalidrawAPI) return;
    const capture = async (): Promise<{ data: string; media_type: string } | null> => {
      try {
        const { exportToBlob } = await import("@excalidraw/excalidraw");
        const blob = await exportToBlob({
          elements: excalidrawAPI.getSceneElements(),
          appState: { ...excalidrawAPI.getAppState(), exportWithDarkMode: false },
          files: excalidrawAPI.getFiles(),
          maxWidthOrHeight: 800,
        });
        const buffer = await blob.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64 = btoa(binary);
        return { data: base64, media_type: blob.type };
      } catch {
        return null;
      }
    };
    setDrawCaptureViewport(capture);
    return () => setDrawCaptureViewport(null);
  }, [excalidrawAPI]);

  // Theme toggle
  const toggleTheme = useCallback(() => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("pneuma-draw-theme", next);
  }, [theme]);

  // Switch Excalidraw to selection tool when entering select mode
  useEffect(() => {
    if (previewMode === "select" && excalidrawAPI) {
      excalidrawAPI.setActiveTool({ type: "selection" });
    }
  }, [previewMode, excalidrawAPI]);

  // Escape key handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && previewMode === "select") {
        if (selection) {
          onSelect(null);
        } else {
          setPreviewMode("view");
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [previewMode, selection, onSelect, setPreviewMode]);

  // Cleanup save timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  // Stable refs for Excalidraw props — avoid re-initialization on parent re-renders
  const handleExcalidrawAPI = useCallback((api: any) => setExcalidrawAPI(api), []);
  const uiOptions = useMemo(() => ({
    canvasActions: {
      saveToActiveFile: false,
      loadScene: false,
      export: false,
      toggleTheme: false,
    },
  }), []);

  const excalidrawFiles = files.filter((f) => f.path.endsWith(".excalidraw"));

  if (!ready || !ExcalidrawComponent) {
    return (
      <div className="flex flex-col h-full">
        <DrawToolbar
          theme={theme}
          onToggleTheme={toggleTheme}
          previewMode={previewMode}
          onSetPreviewMode={setPreviewMode}
        />
        <div className="flex items-center justify-center flex-1 text-neutral-500">
          Loading Excalidraw...
        </div>
      </div>
    );
  }

  if (excalidrawFiles.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <DrawToolbar
          theme={theme}
          onToggleTheme={toggleTheme}
          previewMode={previewMode}
          onSetPreviewMode={setPreviewMode}
        />
        <div className="flex items-center justify-center flex-1 text-neutral-500">
          No .excalidraw files in workspace
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <DrawToolbar
        theme={theme}
        onToggleTheme={toggleTheme}
        previewMode={previewMode}
        onSetPreviewMode={setPreviewMode}
        filePath={activeFilePath || undefined}
      />
      <div
        className="flex-1 relative"
        onPointerUp={handlePointerUp}
      >
        <ExcalidrawComponent
          excalidrawAPI={handleExcalidrawAPI}
          initialData={initialData}
          onChange={handleChange}
          viewModeEnabled={false}
          theme={theme}
          UIOptions={uiOptions}
        />
        {/* View mode: block editing interactions while allowing scroll/zoom via Excalidraw's hand tool */}
        {previewMode === "view" && (
          <div className="absolute inset-0 z-[3]" style={{ cursor: "grab" }} />
        )}
      </div>
    </div>
  );
}

// ── Toolbar ──────────────────────────────────────────────────────────────────

type PreviewMode = "view" | "edit" | "select";

function DrawToolbar({
  theme,
  onToggleTheme,
  previewMode,
  onSetPreviewMode,
  filePath,
}: {
  theme: "light" | "dark";
  onToggleTheme: () => void;
  previewMode: PreviewMode;
  onSetPreviewMode: (mode: PreviewMode) => void;
  filePath?: string;
}) {
  const isDark = theme === "dark";

  const modes: { value: PreviewMode; label: string; icon: React.ReactNode }[] = [
    { value: "view", label: "View", icon: <EyeIcon /> },
    { value: "edit", label: "Edit", icon: <PencilIcon /> },
    { value: "select", label: "Select", icon: <CursorIcon /> },
  ];

  return (
    <div className="flex items-center justify-between gap-1.5 px-3 py-1.5 border-b border-cc-border bg-cc-card/50 shrink-0">
      <div className="flex items-center gap-2">
        {filePath && (
          <span className={`text-xs font-mono ${isDark ? "text-neutral-500" : "text-neutral-400"}`}>
            {filePath}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <div className="flex items-center bg-cc-bg/60 rounded-md p-0.5">
          {modes.map((m) => (
            <button
              key={m.value}
              onClick={() => onSetPreviewMode(m.value)}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors cursor-pointer ${
                previewMode === m.value
                  ? "bg-cc-primary/20 text-cc-primary"
                  : "text-cc-muted hover:text-cc-fg"
              }`}
              title={
                m.value === "view" ? "View only (pan/zoom)"
                  : m.value === "edit" ? "Edit drawing directly"
                  : "Select elements for agent context (Esc to exit)"
              }
            >
              {m.icon}
              <span>{m.label}</span>
            </button>
          ))}
        </div>
        <div className="w-px h-4 bg-cc-border mx-0.5" />
        <button
          onClick={onToggleTheme}
          className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-cc-muted hover:text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer"
          title={isDark ? "Switch to light mode" : "Switch to dark mode"}
        >
          {isDark ? <SunIcon /> : <MoonIcon />}
          <span>{isDark ? "Light" : "Dark"}</span>
        </button>
      </div>
    </div>
  );
}

// ── Icons ────────────────────────────────────────────────────────────────────

function EyeIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
      <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" />
      <circle cx="8" cy="8" r="2" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
      <path d="M11.5 1.5l3 3-9 9H2.5v-3l9-9z" strokeLinejoin="round" />
      <path d="M9 4l3 3" />
    </svg>
  );
}

function CursorIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
      <path d="M3 2l4 12 2-5 5-2L3 2z" strokeLinejoin="round" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" strokeLinecap="round" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
      <path d="M13.5 8.5a5.5 5.5 0 01-7-7 5.5 5.5 0 107 7z" />
    </svg>
  );
}
