import { MarkdownContent } from "./MessageBubble.js";

/**
 * The in-flight assistant bubble. The buffer is always passed in — the root
 * agent's `streaming` in the root conversation, that agent's own entry from
 * `streamingByAgent` in an agent view — so this component never subscribes to
 * the root buffer it might not be showing (which would re-render an agent
 * view on every root token).
 */
export default function StreamingText({ text }: { text: string | null }) {
  if (!text) return null;

  return (
    <div className="flex items-start gap-3">
      <div className="w-6 h-6 rounded-full bg-cc-primary/10 flex items-center justify-center shrink-0 mt-0.5">
        <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 text-cc-primary">
          <circle cx="8" cy="8" r="3" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <MarkdownContent text={text} showCursor />
      </div>
    </div>
  );
}
