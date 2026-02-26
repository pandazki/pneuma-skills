import { useState, useEffect } from "react";
import { useStore } from "../store.js";
import { getToolLabel } from "./ToolBlock.js";

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

function getPhaseLabel(phase: string, toolName?: string): string {
  if (phase === "thinking") return "Thinking";
  if (phase === "responding") return "Writing";
  if (phase === "tool" && toolName) return getToolLabel(toolName);
  if (phase === "tool") return "Running tool";
  return "Working";
}

export default function ActivityIndicator() {
  const activity = useStore((s) => s.activity);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!activity) {
      setElapsed(0);
      return;
    }
    setElapsed(Date.now() - activity.startedAt);
    const timer = setInterval(() => {
      setElapsed(Date.now() - activity.startedAt);
    }, 1000);
    return () => clearInterval(timer);
  }, [activity]);

  if (!activity) return null;

  const label = getPhaseLabel(activity.phase, activity.toolName);

  return (
    <div className="flex items-center gap-2.5 px-3 py-2 animate-[fadeSlideIn_0.15s_ease-out]">
      <Spinner />
      <span className="text-xs text-cc-muted">
        <span className="text-cc-fg font-medium">{label}</span>
        <span className="text-cc-muted/60 ml-1.5">{formatElapsed(elapsed)}</span>
      </span>
    </div>
  );
}

function Spinner() {
  return (
    <svg className="w-4 h-4 text-cc-primary animate-spin" viewBox="0 0 16 16" fill="none">
      <circle
        cx="8" cy="8" r="6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray="28"
        strokeDashoffset="8"
        strokeLinecap="round"
      />
    </svg>
  );
}
