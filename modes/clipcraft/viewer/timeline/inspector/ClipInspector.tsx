import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useComposition,
  useDispatch,
  useSelection,
} from "@pneuma-craft/react";
import type { Clip } from "@pneuma-craft/timeline";
import { useClipProvenance } from "../hooks/useClipProvenance.js";
import { VariantSwitcher } from "./VariantSwitcher.js";
import { theme } from "../../theme/tokens.js";

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

  const selectedClipId =
    selection.type === "clip" && selection.ids.length > 0
      ? selection.ids[0]
      : null;

  const clip: Clip | null = useMemo(() => {
    if (!composition || !selectedClipId) return null;
    for (const t of composition.tracks) {
      const c = t.clips.find((c) => c.id === selectedClipId);
      if (c) return c;
    }
    return null;
  }, [composition, selectedClipId]);

  if (!clip) return null;
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
        borderTop: `1px solid ${theme.color.borderWeak}`,
        background: theme.color.surface1,
        padding: `${theme.space.space2}px ${theme.space.space4}px`,
        display: "flex",
        alignItems: "stretch",
        gap: theme.space.space5,
        fontFamily: theme.font.ui,
        fontSize: theme.text.sm,
        color: theme.color.ink2,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: theme.space.space1,
          minWidth: 200,
        }}
      >
        <span style={sectionLabelStyle}>
          Clip · {clip.id.slice(0, 8)}
        </span>
        <div style={{ display: "flex", gap: theme.space.space2 }}>
          <NumberField
            label="In"
            value={inPoint.toFixed(2)}
            onChange={(v) => setInPoint(parseFloat(v) || 0)}
            onBlur={onBlurField("inPoint")}
          />
          <NumberField
            label="Out"
            value={outPoint.toFixed(2)}
            onChange={(v) => setOutPoint(parseFloat(v) || 0)}
            onBlur={onBlurField("outPoint")}
          />
          <NumberField
            label="Dur"
            value={duration.toFixed(2)}
            onChange={(v) => setDuration(parseFloat(v) || 0.1)}
            onBlur={onBlurField("duration")}
          />
        </div>
      </div>

      <div style={separatorStyle} />

      <VariantSwitcher clip={clip} />

      <div style={separatorStyle} />

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: theme.space.space1,
          flex: 1,
          minWidth: 0,
        }}
      >
        <span style={sectionLabelStyle}>Source</span>
        <span
          style={{
            fontFamily: theme.font.numeric,
            fontSize: theme.text.sm,
            color: theme.color.ink1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            letterSpacing: theme.text.trackingBase,
          }}
          title={summary}
        >
          {summary.split("\n").slice(-1)[0] || "—"}
        </span>
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  onBlur,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur: (e: React.FocusEvent<HTMLInputElement>) => void;
}) {
  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 3,
      }}
    >
      <span style={fieldLabelStyle}>{label}</span>
      <input
        type="number"
        step="0.01"
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        onBlur={onBlur}
        style={numInputStyle}
      />
    </label>
  );
}

const sectionLabelStyle: React.CSSProperties = {
  fontSize: theme.text.xs,
  color: theme.color.ink4,
  textTransform: "uppercase",
  letterSpacing: theme.text.trackingCaps,
  fontWeight: theme.text.weightSemibold,
};

const fieldLabelStyle: React.CSSProperties = {
  fontSize: theme.text.xs,
  color: theme.color.ink4,
  letterSpacing: theme.text.trackingWide,
  fontWeight: theme.text.weightMedium,
};

const numInputStyle: React.CSSProperties = {
  background: theme.color.surface0,
  border: `1px solid ${theme.color.borderWeak}`,
  borderRadius: theme.radius.sm,
  color: theme.color.ink0,
  padding: `3px ${theme.space.space2}px`,
  fontFamily: theme.font.numeric,
  fontVariantNumeric: "tabular-nums",
  fontSize: theme.text.sm,
  width: 60,
  outline: "none",
};

const separatorStyle: React.CSSProperties = {
  width: 1,
  background: theme.color.borderWeak,
  flexShrink: 0,
};
