import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useStore } from "../store.js";
import { getToolLabel } from "./ToolBlock.js";

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

function getPhaseLabel(phase: string, toolName: string | undefined, t: TFunction, tTool: TFunction): string {
  if (phase === "thinking") return t("thinking");
  if (phase === "responding") return t("writing");
  if (phase === "tool" && toolName) return getToolLabel(toolName, tTool);
  if (phase === "tool") return t("running_tool");
  return t("working");
}

export default function ActivityIndicator() {
  const { t } = useTranslation("activity-indicator");
  const { t: tTool } = useTranslation("tool-block");
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

  const label = getPhaseLabel(activity.phase, activity.toolName, t, tTool);

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
