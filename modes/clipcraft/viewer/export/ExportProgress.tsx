import { useEffect, useRef } from "react";
import type { ExportState } from "./useExportVideo.js";
import { XIcon, CheckIcon, WarningIcon } from "../icons/index.js";
import { theme } from "../theme/tokens.js";

export interface ExportProgressProps {
  state: ExportState;
  onAbort: () => void;
  onDismiss: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Inline export progress strip. Renders under the CommandBar while an
 * export is active (or has just finished / errored). When status flips
 * to `"done"`, the browser automatically clicks the download link once
 * via a synthetic anchor — the same pattern most "export + save"
 * flows use.
 */
export function ExportProgress({
  state,
  onAbort,
  onDismiss,
}: ExportProgressProps) {
  const hasDownloaded = useRef(false);

  useEffect(() => {
    if (
      state.status === "done" &&
      state.downloadUrl &&
      state.filename &&
      !hasDownloaded.current
    ) {
      hasDownloaded.current = true;
      const a = document.createElement("a");
      a.href = state.downloadUrl;
      a.download = state.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    if (state.status !== "done") {
      hasDownloaded.current = false;
    }
  }, [state.status, state.downloadUrl, state.filename]);

  if (state.status === "idle") return null;

  const pct = Math.round(state.progress * 100);
  const isActive = state.status === "preparing" || state.status === "exporting";
  const isDone = state.status === "done";
  const isError = state.status === "error";

  const trackColor = theme.color.surface0;
  const fillColor = isError
    ? theme.color.danger
    : isDone
      ? theme.color.success
      : theme.color.accent;

  const label = (() => {
    switch (state.status) {
      case "preparing":
        return "Preparing export…";
      case "exporting":
        return `Exporting… ${pct}%`;
      case "done":
        return state.byteSize != null
          ? `Export ready · ${formatBytes(state.byteSize)}`
          : "Export ready";
      case "error":
        return `Export failed · ${state.error ?? "unknown error"}`;
      default:
        return "";
    }
  })();

  const iconColor = isError
    ? theme.color.dangerInk
    : isDone
      ? theme.color.success
      : theme.color.ink2;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: theme.space.space3,
        padding: `${theme.space.space2}px ${theme.space.space4}px`,
        background: theme.color.surface1,
        borderBottom: `1px solid ${theme.color.borderWeak}`,
        fontFamily: theme.font.ui,
        fontSize: theme.text.sm,
        color: theme.color.ink1,
        flexShrink: 0,
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: theme.space.space2,
          color: iconColor,
          minWidth: 220,
        }}
      >
        {isDone && <CheckIcon size={13} />}
        {isError && <WarningIcon size={13} />}
        <span
          style={{
            letterSpacing: theme.text.trackingBase,
            fontFamily: state.status === "exporting" ? theme.font.numeric : theme.font.ui,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {label}
        </span>
      </span>

      <div
        style={{
          flex: 1,
          height: 4,
          background: trackColor,
          border: `1px solid ${theme.color.borderWeak}`,
          borderRadius: theme.radius.sm,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${isError ? 0 : pct}%`,
            height: "100%",
            background: fillColor,
            transition: `width ${theme.duration.slow}ms ${theme.easing.out}`,
          }}
        />
      </div>

      {isDone && state.downloadUrl && state.filename && (
        <a
          href={state.downloadUrl}
          download={state.filename}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: theme.space.space1,
            height: 24,
            padding: `0 ${theme.space.space3}px`,
            background: theme.color.accentSoft,
            border: `1px solid ${theme.color.accentBorder}`,
            borderRadius: theme.radius.sm,
            color: theme.color.accentBright,
            textDecoration: "none",
            fontSize: theme.text.xs,
            fontWeight: theme.text.weightSemibold,
            letterSpacing: theme.text.trackingCaps,
            textTransform: "uppercase",
          }}
        >
          Download again
        </a>
      )}

      <button
        type="button"
        onClick={isActive ? onAbort : onDismiss}
        aria-label={isActive ? "abort export" : "dismiss export"}
        title={isActive ? "Abort export" : "Dismiss"}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 24,
          height: 24,
          background: "transparent",
          border: `1px solid ${theme.color.borderWeak}`,
          borderRadius: theme.radius.sm,
          color: theme.color.ink2,
          cursor: "pointer",
          padding: 0,
          transition: `color ${theme.duration.quick}ms ${theme.easing.out}, border-color ${theme.duration.quick}ms ${theme.easing.out}`,
        }}
      >
        <XIcon size={11} />
      </button>
    </div>
  );
}
