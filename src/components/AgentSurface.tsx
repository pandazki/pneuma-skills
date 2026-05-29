import ChatPanel from "./ChatPanel.js";

/**
 * AgentSurface — the relocatable home for the agent conversation.
 *
 * This is the "treat the agent as an interaction object" layer: the chat
 * thread, its status (working / idle / model / cost), and the composer. It is
 * deliberately separate from the dev/inspection tools (see ToolDock).
 *
 * Commit ① ships the `docked` form only: a full-height rail that embeds
 * ChatPanel. Commits ②/③ add the `floating` and `collapsed` forms plus the
 * FLIP transitions between them — all wrapping the SAME ChatPanel instance so
 * the conversation never remounts.
 */
export default function AgentSurface() {
  return (
    <div className="agent-surface-docked flex flex-col h-full">
      <ChatPanel />
    </div>
  );
}
