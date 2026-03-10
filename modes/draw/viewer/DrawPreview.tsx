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
import { createPortal } from "react-dom";
import type {
  ViewerPreviewProps,
  ViewerSelectionContext,
} from "../../../core/types/viewer-contract.js";
import { useStore } from "../../../src/store.js";
import { setDrawCaptureViewport } from "../pneuma-mode.js";
import ScaffoldConfirm from "../../../src/components/ScaffoldConfirm.js";

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

/** Parse .excalidraw JSON from files array — prefer activeFile, fallback to first valid */
function parseExcalidrawFile(
  files: ViewerPreviewProps["files"],
  activeFile?: string | null,
): { elements: any[]; appState: any; excalidrawFiles: any; filePath: string } | null {
  // If activeFile specified, try it first
  if (activeFile) {
    const f = files.find((f) => f.path === activeFile);
    if (f) {
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
      } catch { /* skip */ }
    }
  }
  // Fallback: first valid .excalidraw file
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
  onActiveFileChange,
  activeFile,
  navigateRequest,
  onNavigateComplete,
}: ViewerPreviewProps) {
  const setPreviewMode = useStore((s) => s.setPreviewMode);
  const pushUserAction = useStore((s) => s.pushUserAction);
  const annotations = useStore((s) => s.annotations);
  const addAnnotation = useStore((s) => s.addAnnotation);

  // Pending annotation popover state
  const [pendingAnnotation, setPendingAnnotation] = useState<{
    selection: ViewerSelectionContext;
    file: string;
    position: { x: number; y: number };
  } | null>(null);

  // Scaffold state
  const [scaffoldPending, setScaffoldPending] = useState<{
    files: { path: string; content: string }[];
    clearPatterns: string[];
    resolve: (result: { success: boolean; message?: string }) => void;
    source: "agent" | "user";
  } | null>(null);

  const executeScaffold = useCallback(async (
    scaffoldFiles: { path: string; content: string }[],
    clearPatterns: string[],
  ): Promise<{ success: boolean; message?: string }> => {
    const base = getApiBase();
    try {
      const res = await fetch(`${base}/api/workspace/scaffold`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clear: clearPatterns, files: scaffoldFiles }),
      });
      const data = await res.json();
      if (data.success) {
        return { success: true, message: `Created ${data.filesWritten} files` };
      }
      return { success: false, message: data.message || "Scaffold failed" };
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : "Network error" };
    }
  }, []);

  const handleScaffoldConfirm = useCallback(async () => {
    if (!scaffoldPending) return;
    const { files: sFiles, clearPatterns, resolve, source } = scaffoldPending;
    setScaffoldPending(null);
    const result = await executeScaffold(sFiles, clearPatterns);
    resolve(result);
    if (result.success && source === "user") {
      pushUserAction({
        timestamp: Date.now(),
        actionId: "scaffold",
        description: "Reset canvas to empty state",
      });
    }
  }, [scaffoldPending, executeScaffold, pushUserAction]);

  const handleScaffoldCancel = useCallback(() => {
    if (!scaffoldPending) return;
    scaffoldPending.resolve({ success: false, message: "Cancelled by user" });
    setScaffoldPending(null);
  }, [scaffoldPending]);

  // Handle viewer action requests from agent
  useEffect(() => {
    if (!actionRequest) return;

    switch (actionRequest.actionId) {
      case "scaffold": {
        const emptyExcalidraw = JSON.stringify({
          type: "excalidraw",
          version: 2,
          source: "https://excalidraw.com",
          elements: [],
          appState: { viewBackgroundColor: "#ffffff" },
          files: {},
        }, null, 2);
        // Scope to the active file — don't wipe other .excalidraw files
        const targetFile = activeFile || "drawing.excalidraw";
        const reqId = actionRequest.requestId;
        setScaffoldPending({
          files: [{ path: targetFile, content: emptyExcalidraw }],
          clearPatterns: [targetFile],
          source: "agent",
          resolve: (result) => {
            onActionResult?.(reqId, result);
          },
        });
        break;
      }
      default:
        onActionResult?.(actionRequest.requestId, {
          success: false,
          message: `Unknown action: ${actionRequest.actionId}`,
        });
    }
  }, [actionRequest]);

  const [ready, setReady] = useState(excalidrawLoaded);
  const [excalidrawAPI, setExcalidrawAPI] = useState<any>(null);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    return (localStorage.getItem("pneuma-draw-theme") as "light" | "dark") || "dark";
  });

  // Canvas container ref for popover positioning
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  // Stable ref to pushUserAction for use in debounced callbacks
  const pushUserActionRef = useRef(pushUserAction);
  pushUserActionRef.current = pushUserAction;
  // Track element state for user action descriptions
  const prevElementSnapshotRef = useRef<Map<string, { type: string; text?: string }>>(new Map());
  // Track what we last saved to avoid echo from file watcher
  const lastSavedContentRef = useRef<string>("");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentFilePathRef = useRef<string>("");
  // Suppress onChange during Excalidraw remount initialization
  const isUpdatingFromFileRef = useRef(false);
  // Key to force Excalidraw remount on external file changes.
  // updateScene() breaks text rendering — remount goes through proper font init.
  const [excalidrawKey, setExcalidrawKey] = useState(0);

  // Load Excalidraw dynamically
  useEffect(() => {
    if (!ready) {
      loadExcalidraw().then(() => setReady(true));
    }
  }, [ready]);

  // Parse the excalidraw data from files
  const excalidrawData = useMemo(() => parseExcalidrawFile(files, activeFile), [files, activeFile]);

  // Track the active file
  const activeFilePath = excalidrawData?.filePath || null;
  useEffect(() => {
    currentFilePathRef.current = activeFilePath || "";
  }, [activeFilePath]);

  // Notify parent of active file (without showing a selection card)
  useEffect(() => {
    if (activeFilePath) {
      onActiveFileChange?.(activeFilePath);
    }
  }, [activeFilePath]);

  // ── Locator navigation from chat cards ──────────────────────────────────
  useEffect(() => {
    if (!navigateRequest) return;
    const { data } = navigateRequest;
    if (data.file) {
      onActiveFileChange?.(data.file as string);
    }
    onNavigateComplete?.();
  }, [navigateRequest]);

  // Build initial data for Excalidraw — recomputes on remount (key change)
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
  }, [excalidrawKey]);

  // Record content on mount/remount so echo detection works
  useEffect(() => {
    if (!excalidrawData) return;
    lastSavedContentRef.current = serializeToFile(
      excalidrawData.elements,
      excalidrawData.appState,
      excalidrawData.excalidrawFiles,
    );
    // Initialize element snapshot for user action tracking
    const snap = new Map<string, { type: string; text?: string }>();
    for (const el of excalidrawData.elements.filter((e: any) => !e.isDeleted)) {
      snap.set(el.id, { type: el.type, text: el.type === "text" ? el.text : undefined });
    }
    prevElementSnapshotRef.current = snap;
  }, [excalidrawKey]);

  // Sync file changes from disk — force Excalidraw remount instead of updateScene.
  // updateScene() disrupts Excalidraw's internal font rendering, causing text to vanish.
  // Remounting goes through the proper initialData → font init pipeline.
  useEffect(() => {
    if (!excalidrawData) return;
    const newContent = serializeToFile(
      excalidrawData.elements,
      excalidrawData.appState,
      excalidrawData.excalidrawFiles,
    );
    // Skip if content matches (our own save echoing back, or same as initial)
    if (newContent === lastSavedContentRef.current) return;

    // External file change: force Excalidraw remount with new initialData
    isUpdatingFromFileRef.current = true;
    setExcalidrawKey((k) => k + 1);
    setTimeout(() => {
      isUpdatingFromFileRef.current = false;
    }, 500);
  }, [excalidrawData]);

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

        // Track user action for canvas changes
        const active = elements.filter((el: any) => !el.isDeleted);
        const prevSnap = prevElementSnapshotRef.current;
        if (prevSnap.size > 0) {
          const changes: string[] = [];
          const newSnap = new Map<string, { type: string; text?: string }>();
          for (const el of active) {
            newSnap.set(el.id, { type: el.type, text: el.type === "text" ? el.text : undefined });
          }
          for (const [id, info] of newSnap) {
            if (!prevSnap.has(id)) {
              const desc = info.text ? `${info.type} "${info.text.slice(0, 30)}"` : info.type;
              changes.push(`+ ${desc}`);
            }
          }
          for (const [id, info] of prevSnap) {
            if (!newSnap.has(id)) {
              const desc = info.text ? `${info.type} "${info.text.slice(0, 30)}"` : info.type;
              changes.push(`- ${desc}`);
            }
          }
          for (const [id, info] of newSnap) {
            const prev = prevSnap.get(id);
            if (prev && info.text !== undefined && prev.text !== info.text) {
              changes.push(`~ text "${(prev.text || "").slice(0, 20)}" → "${info.text.slice(0, 20)}"`);
            }
          }
          if (changes.length > 0) {
            pushUserActionRef.current({
              timestamp: Date.now(),
              actionId: "edit-canvas",
              description: `Edited canvas:\n${changes.join("\n")}`,
            });
          }
          prevElementSnapshotRef.current = newSnap;
        } else {
          const snap = new Map<string, { type: string; text?: string }>();
          for (const el of active) {
            snap.set(el.id, { type: el.type, text: el.type === "text" ? el.text : undefined });
          }
          prevElementSnapshotRef.current = snap;
        }
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

  // Handle element selection for agent context (select + annotate modes)
  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if ((previewMode !== "select" && previewMode !== "annotate") || !excalidrawAPI) return;

    const appState = excalidrawAPI.getAppState();
    const selectedIds = appState.selectedElementIds || {};
    const selectedIdList = Object.keys(selectedIds).filter((id) => selectedIds[id]);

    if (selectedIdList.length === 0) {
      if (previewMode === "annotate") {
        setPendingAnnotation(null);
      } else {
        onSelect(null);
      }
      return;
    }

    const elements = excalidrawAPI.getSceneElements();
    const selectedElements = elements.filter((el: any) => selectedIdList.includes(el.id));

    if (selectedElements.length === 0) {
      if (previewMode === "annotate") {
        setPendingAnnotation(null);
      } else {
        onSelect(null);
      }
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
    // Build a human-readable label
    const label = selectedElements.length === 1
      ? descriptions[0]
      : `${selectedElements.length} elements (${descriptions.slice(0, 3).join(", ")}${selectedElements.length > 3 ? "\u2026" : ""})`;

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

    const selType = selectedElements.length === 1 ? selectedElements[0].type : "group";

    if (previewMode === "annotate") {
      // Position popover near the pointer
      const containerRect = canvasContainerRef.current?.getBoundingClientRect();
      const posX = containerRect ? e.clientX - containerRect.left : 100;
      const posY = containerRect ? e.clientY - containerRect.top : 100;
      // Capture thumbnail, then show popover
      captureSelectedElements(selectedElements).then((thumbnail) => {
        setPendingAnnotation({
          selection: {
            type: selType,
            content,
            file: currentFilePathRef.current,
            label,
            thumbnail,
          },
          file: currentFilePathRef.current,
          position: { x: posX, y: posY },
        });
      });
    } else {
      // Select mode — capture screenshot then fire onSelect
      captureSelectedElements(selectedElements).then((thumbnail) => {
        onSelect({
          type: selType,
          content,
          file: currentFilePathRef.current,
          label,
          thumbnail,
        });
      });
    }
  }, [previewMode, excalidrawAPI, onSelect, captureSelectedElements]);

  // Confirm pending annotation with comment
  const confirmAnnotation = useCallback(
    (comment: string) => {
      if (!pendingAnnotation) return;
      const { selection: sel, file } = pendingAnnotation;
      addAnnotation({
        id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        slideFile: file,
        element: {
          file,
          type: sel.type as import("../../../src/types.js").SelectionType,
          content: sel.content,
          label: sel.label,
          thumbnail: sel.thumbnail,
        },
        comment,
      });
      setPendingAnnotation(null);
    },
    [pendingAnnotation, addAnnotation],
  );

  // Compute popover position for annotation
  const popoverStyle = useMemo((): React.CSSProperties => {
    if (!pendingAnnotation || !canvasContainerRef.current) return {};
    const { position } = pendingAnnotation;
    const containerWidth = canvasContainerRef.current.clientWidth;
    return {
      position: "absolute",
      top: position.y + 12,
      left: Math.max(8, Math.min(position.x - 140, containerWidth - 288)),
      zIndex: 50,
      width: 280,
    };
  }, [pendingAnnotation]);

  // Clear pending annotation when leaving annotate mode
  useEffect(() => {
    if (previewMode !== "annotate") {
      setPendingAnnotation(null);
    }
  }, [previewMode]);

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

  // Switch Excalidraw to selection tool when entering select/annotate mode
  useEffect(() => {
    if ((previewMode === "select" || previewMode === "annotate") && excalidrawAPI) {
      excalidrawAPI.setActiveTool({ type: "selection" });
    }
  }, [previewMode, excalidrawAPI]);

  // Escape key handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (previewMode === "annotate") {
          if (pendingAnnotation) {
            setPendingAnnotation(null);
          } else {
            setPreviewMode("view");
          }
        } else if (previewMode === "select") {
          if (selection) {
            onSelect(null);
          } else {
            setPreviewMode("view");
          }
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [previewMode, pendingAnnotation, selection, onSelect, setPreviewMode]);

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
        ref={canvasContainerRef}
        className="flex-1 relative"
        onPointerUp={handlePointerUp}
      >
        <ExcalidrawComponent
          key={excalidrawKey}
          excalidrawAPI={handleExcalidrawAPI}
          initialData={initialData}
          onChange={handleChange}
          viewModeEnabled={previewMode === "view"}
          theme={theme}
          UIOptions={uiOptions}
        />
        {/* View mode uses Excalidraw's native viewModeEnabled — allows pan/zoom, hides toolbar */}
        {/* Annotation popover */}
        {pendingAnnotation && (
          <AnnotationPopover
            style={popoverStyle}
            label={pendingAnnotation.selection.label}
            onConfirm={confirmAnnotation}
            onCancel={() => setPendingAnnotation(null)}
          />
        )}
      </div>
      {scaffoldPending && createPortal(
        <ScaffoldConfirm
          clearPatterns={scaffoldPending.clearPatterns}
          files={scaffoldPending.files}
          onConfirm={handleScaffoldConfirm}
          onCancel={handleScaffoldCancel}
        />,
        document.body,
      )}
    </div>
  );
}

// ── Toolbar ──────────────────────────────────────────────────────────────────

type PreviewMode = "view" | "edit" | "select" | "annotate";

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
    { value: "annotate", label: "Annotate", icon: <AnnotateIcon /> },
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
                  : m.value === "select" ? "Select elements for agent context (Esc to exit)"
                  : "Annotate elements with comments (Esc to exit)"
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

function AnnotateIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
      <path d="M2 2h12v9H6l-4 3V2z" strokeLinejoin="round" />
      <circle cx="5" cy="6.5" r="0.5" fill="currentColor" stroke="none" />
      <circle cx="8" cy="6.5" r="0.5" fill="currentColor" stroke="none" />
      <circle cx="11" cy="6.5" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

// ── Annotation Popover ──────────────────────────────────────────────────────

function AnnotationPopover({
  style,
  label,
  onConfirm,
  onCancel,
}: {
  style: React.CSSProperties;
  label?: string;
  onConfirm: (comment: string) => void;
  onCancel: () => void;
}) {
  const [comment, setComment] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onConfirm(comment);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
  };

  return (
    <div
      style={style}
      className="bg-neutral-800 border border-neutral-600 rounded-lg shadow-xl p-3 text-sm"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2 mb-2 min-w-0">
        <span className="text-neutral-300 truncate text-xs">{label || "Element"}</span>
      </div>
      <input
        ref={inputRef}
        type="text"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Add comment (optional)..."
        className="w-full bg-neutral-900 border border-neutral-600 rounded px-2 py-1.5 text-sm text-white placeholder-neutral-500 outline-none focus:border-blue-500"
      />
      <div className="flex justify-end gap-2 mt-2">
        <button
          onClick={onCancel}
          className="px-2.5 py-1 text-xs text-neutral-400 hover:text-white rounded hover:bg-neutral-700 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={() => onConfirm(comment)}
          className="px-2.5 py-1 text-xs text-white bg-blue-600 hover:bg-blue-500 rounded transition-colors"
        >
          Add
        </button>
      </div>
    </div>
  );
}
