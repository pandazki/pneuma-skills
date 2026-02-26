import { useStore } from "../store.js";
import { MarkdownContent } from "./MessageBubble.js";

export default function StreamingText() {
  const streaming = useStore((s) => s.streaming);

  if (!streaming) return null;

  return (
    <div className="flex items-start gap-3">
      <div className="w-6 h-6 rounded-full bg-cc-primary/10 flex items-center justify-center shrink-0 mt-0.5">
        <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 text-cc-primary">
          <circle cx="8" cy="8" r="3" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <MarkdownContent text={streaming} showCursor />
      </div>
    </div>
  );
}
