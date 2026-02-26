import { useEffect } from "react";
import { Panel, Group, Separator } from "react-resizable-panels";
import StatusBar from "./components/StatusBar.js";
import MarkdownPreview from "./components/MarkdownPreview.js";
import ChatPanel from "./components/ChatPanel.js";
import { connect } from "./ws.js";

export default function App() {
  // Connect to WebSocket session on mount
  // The session ID is passed as a URL param or we use "default"
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const sessionId = params.get("session") || "default";
    connect(sessionId);
  }, []);

  return (
    <div className="flex flex-col h-screen bg-neutral-950 text-neutral-100">
      <StatusBar />
      <Group orientation="horizontal" className="flex-1">
        <Panel defaultSize={55} minSize={30}>
          <MarkdownPreview />
        </Panel>
        <Separator className="w-1 bg-neutral-800 hover:bg-neutral-700 transition-colors" />
        <Panel defaultSize={45} minSize={25}>
          <ChatPanel />
        </Panel>
      </Group>
    </div>
  );
}
