import { useEffect, useMemo, useRef, useState } from "react";
import {
  useAssets,
  useComposition,
  usePlayback,
} from "@pneuma-craft/react";
import { theme } from "../theme/tokens.js";
import type { PanelEntry, StoryboardEntry } from "./useSetupListing.js";
import { SectionShell, EmptyHint } from "./BibleSection.js";
import {
  computePanelStatus,
  type PanelStatus,
} from "./storyboardPanelStatus.js";

/**
 * StoryboardSection — lists every storyboard directory under
 * `storyboard/<id>/` as a row containing the composite thumbnail
 * with an SVG grid overlay drawn at panel boundaries.
 *
 * Click interaction:
 *   - placed:       seek the playhead to the previewFrame's time.
 *   - registered:   toast "Panel not yet placed on the timeline."
 *   - unregistered: toast "Panel not yet registered. Ask the agent…"
 *
 * Toast UX is intentionally minimal in v1 — a transient banner pinned
 * to the storyboard row; v2 can swap in a global toast service. We
 * also `console.warn` the same payload so hooks/automation can scrape.
 *
 * If the storyboard has no `stdout.json` (so all `bbox.w === 0`), the
 * overlay is omitted but the storyboard is still listed and the
 * full-size composite remains clickable for inspection.
 */

interface Props {
  storyboards: StoryboardEntry[];
  workspaceUrl: (p: string) => string;
  emptyHint: React.ReactNode;
}

export function StoryboardSection({ storyboards, workspaceUrl, emptyHint }: Props) {
  const count = storyboards.length;
  return (
    <SectionShell title={`Storyboards (${count})`} defaultOpen>
      {count === 0 ? (
        <EmptyHint>{emptyHint}</EmptyHint>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: theme.space.space3,
            padding: theme.space.space3,
          }}
        >
          {storyboards.map((sb) => (
            <StoryboardCard
              key={sb.id}
              storyboard={sb}
              workspaceUrl={workspaceUrl}
            />
          ))}
        </div>
      )}
    </SectionShell>
  );
}

function StoryboardCard({
  storyboard,
  workspaceUrl,
}: {
  storyboard: StoryboardEntry;
  workspaceUrl: (p: string) => string;
}) {
  const assets = useAssets();
  const composition = useComposition();
  const playback = usePlayback();

  // Flatten preview frames across every track so we can match by assetId.
  const previewFrames = useMemo(() => {
    const out: { id: string; trackId: string; time: number; assetId: string }[] = [];
    for (const t of composition?.tracks ?? []) {
      for (const pf of t.previewFrames ?? []) {
        out.push({
          id: pf.id,
          trackId: pf.trackId,
          time: pf.time,
          assetId: pf.assetId,
        });
      }
    }
    return out;
  }, [composition]);

  const assetIndex = useMemo(
    () => assets.map((a) => ({ id: a.id, uri: a.uri })),
    [assets],
  );

  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);
  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  };

  const handlePanelClick = (panel: PanelEntry) => {
    const status: PanelStatus = computePanelStatus({
      panelPath: panel.path,
      panelAssetId: panel.assetId,
      assets: assetIndex,
      previewFrames,
    });
    if (status.kind === "placed") {
      playback.seek(status.time);
    } else if (status.kind === "registered") {
      console.warn("[setup-tab] panel registered but not placed", { panel });
      showToast("Panel not yet placed on the timeline.");
    } else {
      console.warn("[setup-tab] panel unregistered", { panel });
      showToast(
        "Panel not yet registered. Ask the agent to register storyboard panels.",
      );
    }
  };

  // Compute the natural composite dimensions on load so the SVG overlay
  // can use a viewBox in composite-image coordinates and the panel
  // bboxes (which are in composite-image space) line up exactly.
  const [naturalDims, setNaturalDims] = useState<{ w: number; h: number } | null>(null);

  const hasBboxData = storyboard.panels.some((p) => p.bbox.w > 0 && p.bbox.h > 0);
  const compositeUrl = `${workspaceUrl(storyboard.compositePath)}?v=${storyboard.mtime}`;

  // Summary line: panel count, grid (if known), aspect (if natural dims loaded)
  const summary = useMemo(() => {
    const parts: string[] = [`${storyboard.panels.length} panels`];
    if (storyboard.grid) parts.push(`${storyboard.grid.rows}×${storyboard.grid.cols}`);
    if (naturalDims) {
      const ratio = simplifyRatio(naturalDims.w, naturalDims.h);
      if (ratio) parts.push(ratio);
    }
    parts.push(storyboard.hasStdoutJson ? "registered metadata" : "lex-fallback panels");
    return parts.join(" · ");
  }, [storyboard, naturalDims]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: theme.space.space2,
      }}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          background: theme.color.surface0,
          border: `1px solid ${theme.color.borderWeak}`,
          borderRadius: theme.radius.sm,
          overflow: "hidden",
          lineHeight: 0,
        }}
      >
        <img
          src={compositeUrl}
          alt={`Composite for ${storyboard.id}`}
          style={{
            display: "block",
            width: "100%",
            height: "auto",
            objectFit: "contain",
          }}
          onLoad={(e) => {
            const el = e.currentTarget;
            setNaturalDims({ w: el.naturalWidth, h: el.naturalHeight });
          }}
        />
        {hasBboxData && naturalDims && (
          <PanelOverlay
            panels={storyboard.panels}
            naturalWidth={naturalDims.w}
            naturalHeight={naturalDims.h}
            onClick={handlePanelClick}
          />
        )}
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 2,
          fontFamily: theme.font.ui,
        }}
      >
        <span
          style={{
            fontSize: theme.text.sm,
            fontWeight: theme.text.weightSemibold,
            color: theme.color.ink1,
            letterSpacing: theme.text.trackingTight,
          }}
        >
          {storyboard.id}
        </span>
        <span
          style={{
            fontSize: theme.text.xs,
            color: theme.color.ink3,
            letterSpacing: theme.text.trackingBase,
          }}
        >
          {summary}
        </span>
        {hasBboxData ? (
          <span
            style={{
              fontSize: theme.text.xs,
              color: theme.color.ink4,
              fontStyle: "italic",
            }}
          >
            Click a panel to seek the timeline.
          </span>
        ) : (
          <span
            style={{
              fontSize: theme.text.xs,
              color: theme.color.ink4,
              fontStyle: "italic",
            }}
          >
            No panel-grid metadata — composite shown without overlay.
          </span>
        )}
      </div>

      {toast && (
        <div
          role="status"
          style={{
            padding: `${theme.space.space2}px ${theme.space.space3}px`,
            background: theme.color.warnSoft,
            border: `1px solid ${theme.color.borderWeak}`,
            borderRadius: theme.radius.sm,
            fontSize: theme.text.xs,
            color: theme.color.warnInk,
            letterSpacing: theme.text.trackingBase,
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}

function PanelOverlay({
  panels,
  naturalWidth,
  naturalHeight,
  onClick,
}: {
  panels: PanelEntry[];
  naturalWidth: number;
  naturalHeight: number;
  onClick: (p: PanelEntry) => void;
}) {
  return (
    <svg
      viewBox={`0 0 ${naturalWidth} ${naturalHeight}`}
      preserveAspectRatio="none"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
      }}
    >
      {panels.map((p) => (
        <g key={`${p.index}-${p.path}`}>
          <rect
            x={p.bbox.x}
            y={p.bbox.y}
            width={p.bbox.w}
            height={p.bbox.h}
            fill="transparent"
            stroke={theme.color.accentBorder}
            strokeWidth={Math.max(2, naturalWidth / 600)}
            style={{ pointerEvents: "auto", cursor: "pointer" }}
            onClick={(e) => {
              e.stopPropagation();
              onClick(p);
            }}
            onMouseEnter={(e) => {
              const el = e.currentTarget;
              el.setAttribute("fill", theme.color.accentSoft);
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget;
              el.setAttribute("fill", "transparent");
            }}
          >
            <title>{`Panel ${p.index}`}</title>
          </rect>
        </g>
      ))}
    </svg>
  );
}

function simplifyRatio(w: number, h: number): string | null {
  if (!w || !h) return null;
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const g = gcd(w, h);
  const rw = w / g;
  const rh = h / g;
  // Only show clean small ratios — otherwise the visual noise outweighs.
  if (rw > 32 || rh > 32) return null;
  return `${rw}:${rh}`;
}
