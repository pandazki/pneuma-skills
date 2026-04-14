import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useComposition,
  useDispatch,
  useSelection,
} from "@pneuma-craft/react";
import type { Clip } from "@pneuma-craft/timeline";
import { useClipProvenance } from "../hooks/useClipProvenance.js";
import { VariantSwitcher } from "./VariantSwitcher.js";

/**
 * Bottom-anchored clip inspector. Rendered inside TimelineShell between
 * the 3D panel and the Timeline. When no clip is selected the strip
 * collapses to zero height (`display: none`) so it doesn't shift layout.
 *
 * Numeric edits are debounced locally and dispatched as a single
 * composition:trim-clip (+ composition:move-clip for inPoint changes)
 * on blur or after 400ms of quiet.
 */
export function ClipInspector() {
  const composition = useComposition();
  const selection = useSelection();
  const dispatch = useDispatch();

  const selectedClipId =
    selection.type === "clip" && selection.ids.length > 0 ? selection.ids[0] : null;

  const clip: Clip | null = useMemo(() => {
    if (!composition || !selectedClipId) return null;
    for (const t of composition.tracks) {
      const c = t.clips.find((c) => c.id === selectedClipId);
      if (c) return c;
    }
    return null;
  }, [composition, selectedClipId]);

  if (!clip) {
    // Fully hidden — no layout space consumed when nothing is selected.
    return null;
  }
  return <ClipInspectorActive clip={clip} />;
}

function ClipInspectorActive({ clip }: { clip: Clip }) {
  const dispatch = useDispatch();
  const { summary } = useClipProvenance(clip);

  // Local draft state to allow free-form editing before dispatching.
  const [inPoint, setInPoint] = useState(clip.inPoint);
  const [outPoint, setOutPoint] = useState(clip.outPoint);
  const [duration, setDuration] = useState(clip.duration);

  // Sync local state to clip updates (e.g., undo, external edits).
  useEffect(() => {
    setInPoint(clip.inPoint);
    setOutPoint(clip.outPoint);
    setDuration(clip.duration);
  }, [clip.id, clip.inPoint, clip.outPoint, clip.duration]);

  const commit = useCallback(
    (next: { inPoint?: number; outPoint?: number; duration?: number }) => {
      const finalIn = next.inPoint ?? inPoint;
      const finalOut = next.outPoint ?? outPoint;
      const finalDur = next.duration ?? duration;
      // Clamp
      const clampedDur = Math.max(0.1, finalDur);
      dispatch("human", {
        type: "composition:trim-clip",
        clipId: clip.id,
        inPoint: Math.max(0, finalIn),
        outPoint: Math.max(0, finalOut),
        duration: clampedDur,
      });
    },
    [dispatch, clip.id, inPoint, outPoint, duration],
  );

  const onBlurField =
    (field: "inPoint" | "outPoint" | "duration") =>
    (e: React.FocusEvent<HTMLInputElement>) => {
      const v = parseFloat(e.currentTarget.value);
      if (Number.isNaN(v)) return;
      commit({ [field]: v });
    };

  return (
    <div
      style={{
        borderTop: "1px solid #27272a",
        borderBottom: "1px solid #18181b",
        background: "#0f0f11",
        padding: "8px 12px",
        display: "flex",
        alignItems: "stretch",
        gap: 16,
        fontSize: 10,
        color: "#a1a1aa",
      }}
    >
      {/* Numeric fields */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 180 }}>
        <span style={{ fontSize: 9, color: "#52525b", textTransform: "uppercase" }}>
          clip · {clip.id.slice(0, 8)}
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          <label style={labelStyle}>
            In
            <input
              type="number"
              step="0.01"
              value={inPoint.toFixed(2)}
              onChange={(e) => setInPoint(parseFloat(e.currentTarget.value) || 0)}
              onBlur={onBlurField("inPoint")}
              style={numInputStyle}
            />
          </label>
          <label style={labelStyle}>
            Out
            <input
              type="number"
              step="0.01"
              value={outPoint.toFixed(2)}
              onChange={(e) => setOutPoint(parseFloat(e.currentTarget.value) || 0)}
              onBlur={onBlurField("outPoint")}
              style={numInputStyle}
            />
          </label>
          <label style={labelStyle}>
            Dur
            <input
              type="number"
              step="0.01"
              value={duration.toFixed(2)}
              onChange={(e) => setDuration(parseFloat(e.currentTarget.value) || 0.1)}
              onBlur={onBlurField("duration")}
              style={numInputStyle}
            />
          </label>
        </div>
      </div>

      <div style={separatorStyle} />

      <VariantSwitcher clip={clip} />

      <div style={separatorStyle} />

      {/* Provenance summary — the same text shown as clip tooltip */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 9, color: "#52525b", textTransform: "uppercase" }}>
          source
        </span>
        <span
          style={{
            fontSize: 10,
            color: "#e4e4e7",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontFamily: "ui-monospace, SFMono-Regular, monospace",
          }}
          title={summary}
        >
          {summary.split("\n").slice(-1)[0] || "—"}
        </span>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
  fontSize: 9,
  color: "#52525b",
};

const numInputStyle: React.CSSProperties = {
  background: "#18181b",
  border: "1px solid #27272a",
  borderRadius: 3,
  color: "#e4e4e7",
  padding: "2px 4px",
  fontSize: 10,
  fontFamily: "ui-monospace, SFMono-Regular, monospace",
  width: 54,
};

const separatorStyle: React.CSSProperties = {
  width: 1,
  background: "#18181b",
  flexShrink: 0,
};
