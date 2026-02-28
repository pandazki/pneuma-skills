import { useEffect, useState, lazy, Suspense } from "react";
import { Panel, Group, Separator } from "react-resizable-panels";
import TopBar from "./components/TopBar.js";
import ChatPanel from "./components/ChatPanel.js";
import DiffPanel from "./components/DiffPanel.js";
import ProcessPanel from "./components/ProcessPanel.js";
import ContextPanel from "./components/ContextPanel.js";
import { useStore } from "./store.js";
import type { SelectionType } from "./types.js";
import { connect } from "./ws.js";
import { loadMode } from "../core/mode-loader.js";
import type { ViewerPreviewProps } from "../core/types/viewer-contract.js";

const EditorPanel = lazy(() => import("./components/EditorPanel.js"));
const TerminalPanel = lazy(() => import("./components/TerminalPanel.js"));

function LazyFallback() {
  return (
    <div className="flex items-center justify-center h-full text-neutral-600 text-sm">
      Loading...
    </div>
  );
}

function RightPanel() {
  const activeTab = useStore((s) => s.activeTab);
  const [terminalMounted, setTerminalMounted] = useState(false);

  useEffect(() => {
    if (activeTab === "terminal") setTerminalMounted(true);
  }, [activeTab]);

  return (
    <div className="flex flex-col h-full">
      {activeTab === "chat" && <ChatPanel />}
      {activeTab === "editor" && (
        <Suspense fallback={<LazyFallback />}>
          <EditorPanel />
        </Suspense>
      )}
      {activeTab === "diff" && <DiffPanel />}
      {/* Terminal stays mounted once visited to preserve PTY connection */}
      {terminalMounted && (
        <Suspense fallback={activeTab === "terminal" ? <LazyFallback /> : null}>
          <div className={activeTab === "terminal" ? "flex flex-col h-full" : "hidden"}>
            <TerminalPanel />
          </div>
        </Suspense>
      )}
      {activeTab === "processes" && <ProcessPanel />}
      {activeTab === "context" && <ContextPanel />}
    </div>
  );
}

/** Build the ViewerPreviewProps from store state. */
function useViewerProps(): ViewerPreviewProps {
  const files = useStore((s) => s.files);
  const selection = useStore((s) => s.selection);
  const setSelection = useStore((s) => s.setSelection);
  const previewMode = useStore((s) => s.previewMode);
  const imageTick = useStore((s) => s.imageTick);
  const initParams = useStore((s) => s.initParams);
  const setActiveFile = useStore((s) => s.setActiveFile);

  return {
    files: files.map((f) => ({ path: f.path, content: f.content })),
    selection: selection
      ? {
          type: selection.type,
          content: selection.content,
          level: selection.level,
          file: selection.file,
          tag: selection.tag,
          classes: selection.classes,
          selector: selection.selector,
          thumbnail: selection.thumbnail,
        }
      : null,
    onSelect: (sel) => {
      if (!sel) {
        setSelection(null);
        return;
      }
      // Use file from the viewer component (e.g. current slide), fallback to first file
      const file = sel.file || files[0]?.path || "";
      setSelection({
        type: sel.type as SelectionType,
        content: sel.content,
        level: sel.level,
        file,
        tag: sel.tag,
        classes: sel.classes,
        selector: sel.selector,
        thumbnail: sel.thumbnail,
      });
    },
    mode: previewMode,
    imageVersion: imageTick,
    initParams,
    onActiveFileChange: setActiveFile,
  };
}

function getApiBase(): string {
  if (import.meta.env.DEV) {
    return `http://${location.hostname}:${import.meta.env.VITE_API_PORT || "17007"}`;
  }
  return "";
}

export default function App() {
  const PreviewComponent = useStore((s) => s.modeViewer?.PreviewComponent);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const explicitSession = params.get("session");
    const modeName = params.get("mode") || "doc";

    // Load mode dynamically via mode-loader
    loadMode(modeName)
      .then((def) => {
        useStore.getState().setModeViewer(def.viewer);
      })
      .catch((err) => {
        console.error(`[app] Failed to load mode "${modeName}":`, err);
      });

    // Connect to session
    if (explicitSession) {
      connect(explicitSession);
    } else {
      fetch(`${getApiBase()}/api/session`)
        .then((r) => r.json())
        .then((d) => {
          connect(d.sessionId || "default");
        })
        .catch(() => connect("default"));
    }

    // Fetch initial file contents for the preview
    fetch(`${getApiBase()}/api/files`)
      .then((r) => r.json())
      .then((d) => {
        if (d.files?.length) useStore.getState().setFiles(d.files);
      })
      .catch(() => {});

    // Fetch mode init params
    fetch(`${getApiBase()}/api/config`)
      .then((r) => r.json())
      .then((d) => {
        if (d.initParams) useStore.getState().setInitParams(d.initParams);
      })
      .catch(() => {});

    // Check git availability
    fetch(`${getApiBase()}/api/git/available`)
      .then((r) => r.json())
      .then((d) => useStore.getState().setGitAvailable(d.available))
      .catch(() => useStore.getState().setGitAvailable(false));
  }, []);

  const viewerProps = useViewerProps();

  return (
    <div className="flex flex-col h-screen bg-neutral-950 text-neutral-100">
      <TopBar />
      <Group orientation="horizontal" className="flex-1">
        <Panel defaultSize={60} minSize={30}>
          {PreviewComponent ? (
            <PreviewComponent {...viewerProps} />
          ) : (
            <LazyFallback />
          )}
        </Panel>
        <Separator className="w-1 bg-neutral-800 hover:bg-neutral-700 transition-colors" />
        <Panel defaultSize={40} minSize={25}>
          <RightPanel />
        </Panel>
      </Group>
    </div>
  );
}
