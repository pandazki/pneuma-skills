import { useState, useRef, type KeyboardEvent } from "react";
import { useStore } from "../store.js";
import { sendUserMessage, sendInterrupt } from "../ws.js";

export default function ChatInput() {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sessionStatus = useStore((s) => s.sessionStatus);
  const cliConnected = useStore((s) => s.cliConnected);

  const isRunning = sessionStatus === "running";

  const handleSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    sendUserMessage(trimmed);
    setText("");
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
