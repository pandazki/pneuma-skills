import { useEffect, useState, lazy, Suspense } from "react";
import { Panel, Group, Separator } from "react-resizable-panels";
import TopBar from "./components/TopBar.js";
import MarkdownPreview from "./components/MarkdownPreview.js";
import ChatPanel from "./components/ChatPanel.js";
import DiffPanel from "./components/DiffPanel.js";
import ProcessPanel from "./components/ProcessPanel.js";
import ContextPanel from "./components/ContextPanel.js";
import { useStore } from "./store.js";
import { connect } from "./ws.js";

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

function getApiBase(): string {
  if (import.meta.env.DEV) {
    return `http://${location.hostname}:${import.meta.env.VITE_API_PORT || "17007"}`;
  }
  return "";
}

export default function App() {
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const explicitSession = params.get("session");

    if (explicitSession) {
      connect(explicitSession);
    } else {
      // Auto-discover the active session from the server
      fetch(`${getApiBase()}/api/session`)
        .then((r) => r.json())
        .then((d) => {
          connect(d.sessionId || "default");
        })
        .catch(() => connect("default"));
    }

    // Check git availability
    fetch(`${getApiBase()}/api/git/available`)
      .then((r) => r.json())
      .then((d) => useStore.getState().setGitAvailable(d.available))
      .catch(() => useStore.getState().setGitAvailable(false));
  }, []);

  return (
    <div className="flex flex-col h-screen bg-neutral-950 text-neutral-100">
      <TopBar />
      <Group orientation="horizontal" className="flex-1">
        <Panel defaultSize={55} minSize={30}>
          <MarkdownPreview />
        </Panel>
        <Separator className="w-1 bg-neutral-800 hover:bg-neutral-700 transition-colors" />
        <Panel defaultSize={45} minSize={25}>
          <RightPanel />
        </Panel>
      </Group>
    </div>
  );
}
