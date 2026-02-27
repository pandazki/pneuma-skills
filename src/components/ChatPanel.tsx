import { useEffect, useRef } from "react";
import { useStore } from "../store.js";
import MessageBubble from "./MessageBubble.js";
import StreamingText from "./StreamingText.js";
import ActivityIndicator from "./ActivityIndicator.js";
import PermissionBanner from "./PermissionBanner.js";
import ChatInput from "./ChatInput.js";

export default function ChatPanel() {
  const messages = useStore((s) => s.messages);
  const streaming = useStore((s) => s.streaming);
  const activity = useStore((s) => s.activity);
  const cliConnected = useStore((s) => s.cliConnected);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive or streaming/activity updates
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, streaming, activity]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && !streaming && !activity && (
          <div className="text-cc-muted text-sm text-center mt-8">
            {cliConnected ? "Send a message to start editing" : "Connecting to Claude..."}
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {streaming ? <StreamingText /> : activity ? <ActivityIndicator /> : null}
        <div ref={bottomRef} />
      </div>
      <PermissionBanner />
      <ChatInput />
    </div>
  );
}
