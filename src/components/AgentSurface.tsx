import ChatPanel from "./ChatPanel.js";
import AgentSurfaceControls from "./AgentSurfaceControls.js";

/**
 * AgentSurface (docked form) — the relocatable home for the agent conversation
 * when it lives in the side rail. This is the "treat the agent as an
 * interaction object" layer: the chat thread, its status (working / idle /
 * model / cost), and the composer — deliberately separate from the
 * dev/inspection tools (see ToolDock).
 *
 * The floating and collapsed forms are AgentFloating / AgentBubble; all three
 * wrap the same ChatPanel so the conversation never remounts when the user
 * relocates it. The form-switch cluster sits top-left, mirroring ChatPanel's
 * status pill at top-right.
 */
export default function AgentSurface() {
  return (
    <div className="agent-surface-docked relative flex flex-col h-full">
      <div className="absolute top-3.5 left-4 z-20">
        <AgentSurfaceControls form="docked" />
      </div>
      <ChatPanel />
    </div>
  );
}
