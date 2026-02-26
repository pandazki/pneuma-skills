import { useState, useRef, type KeyboardEvent } from "react";
import { useStore } from "../store.js";
import { sendUserMessage, sendInterrupt } from "../ws.js";

/** Format selection info for display in the chip */
function formatSelectionLabel(sel: { type: string; content: string; level?: number; file: string }): string {
  const typeLabels: Record<string, string> = {
    heading: `h${sel.level || 1}`,
    paragraph: "paragraph",
    list: "list",
    code: "code block",
    blockquote: "blockquote",
    image: "image",
    table: "table",
    "text-range": "text",
  };
  const type = typeLabels[sel.type] || sel.type;
  const preview = sel.content.length > 60 ? sel.content.slice(0, 57) + "..." : sel.content;
  return `${type}: "${preview}"`;
}

export default function ChatInput() {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sessionStatus = useStore((s) => s.sessionStatus);
  const cliConnected = useStore((s) => s.cliConnected);
  const selection = useStore((s) => s.selection);
  const setSelection = useStore((s) => s.setSelection);

  const isRunning = sessionStatus === "running";

  const handleSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    sendUserMessage(trimmed, selection);
    setText("");
    setSelection(null);
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInput = () => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    }
  };

  return (
    <div className="p-3 border-t border-neutral-800">
      {selection && (
        <div className="flex items-center gap-2 mb-2 px-1">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-cc-primary/15 text-cc-primary text-xs max-w-full overflow-hidden">
            <PinIcon />
            <span className="truncate">{formatSelectionLabel(selection)}</span>
            <span className="shrink-0 text-cc-muted mx-0.5">in {selection.file}</span>
            <button
              onClick={() => setSelection(null)}
              className="shrink-0 ml-0.5 hover:text-cc-fg transition-colors cursor-pointer"
              title="Clear selection"
            >
              <CloseIcon />
            </button>
          </div>
        </div>
      )}
      <div className="flex gap-2">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          placeholder={
            !cliConnected
              ? "Waiting for CLI connection..."
              : isRunning
                ? "Claude is working..."
                : selection
                  ? "Tell Claude what to change..."
                  : "Send a message..."
          }
          disabled={!cliConnected}
          rows={1}
          className="flex-1 bg-neutral-800 text-neutral-100 rounded-lg px-3 py-2 text-sm resize-none placeholder-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-600 disabled:opacity-50"
        />
        {isRunning ? (
          <button
            onClick={sendInterrupt}
            className="px-4 py-2 bg-red-700 hover:bg-red-600 text-white text-sm rounded-lg transition-colors"
          >
            Stop
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={!text.trim() || !cliConnected}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Send
          </button>
        )}
      </div>
    </div>
  );
}

function PinIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 shrink-0">
      <path d="M9.828 1.282a.75.75 0 011.06 0l3.83 3.83a.75.75 0 010 1.06l-3.17 3.17a.75.75 0 01-.254.166l-1.97.738.738-1.97a.75.75 0 01.166-.254l3.17-3.17-2.77-2.77-3.17 3.17a.75.75 0 01-.254.166l-1.97.738.738-1.97a.75.75 0 01.166-.254l3.17-3.17a.75.75 0 010-1.06zM1.5 14.5l4-4" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
      <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
    </svg>
  );
}
