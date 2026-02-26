import { useEffect } from "react";
import { Panel, Group, Separator } from "react-resizable-panels";
import TopBar from "./components/TopBar.js";
import MarkdownPreview from "./components/MarkdownPreview.js";
import ChatPanel from "./components/ChatPanel.js";
import { useStore } from "./store.js";
import { connect } from "./ws.js";

function PlaceholderTab({ name }: { name: string }) {
  return (
    <div className="flex items-center justify-center h-full text-neutral-600 text-sm">
      {name} — coming soon
    </div>
  );
}

function RightPanel() {
  const activeTab = useStore((s) => s.activeTab);

  return (
    <div className="flex flex-col h-full">
      {activeTab === "chat" && <ChatPanel />}
      {activeTab === "diff" && <PlaceholderTab name="Diffs" />}
      {activeTab === "terminal" && <PlaceholderTab name="Terminal" />}
      {activeTab === "processes" && <PlaceholderTab name="Processes" />}
    </div>
  );
}

export default function App() {
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const sessionId = params.get("session") || "default";
    connect(sessionId);
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
