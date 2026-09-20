/**
 * The stage — the shot's lanes, laid out four ways.
 *
 * Side puts every lane the shot has next to each other; Wipe and Blend put
 * ONE PAIR on the same pixels, which is the only way a silhouette or a camera
 * drift is judged rather than remembered; Solo gives one lane the room.
 *
 * Every layout draws the same `LaneSurface` components, and every surface
 * reads the same clock — a layout change never restarts anything.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { SceneMeta, Take } from "../domain.js";
import { LaneHeader, LaneSurface, Segment } from "./Lane.js";
import {
  LAYOUT_IDS,
  LAYOUT_LABEL,
  clamp,
  planSideLayout,
  takeLabel,
  visibleLanes,
  type CameraMode,
  type GreyboxMode,
  type LaneId,
  type LaneView,
  type LayoutId,
} from "./stage-model.js";
import type { Clock } from "./usePlayhead.js";

/** `p-2` on the stage box, `gap-2` between cards, and a two-row lane header. */
const STAGE_PADDING = 16;
const LANE_GAP = 8;
const LANE_HEADER_H = 46;
/** Blend's opacity strip under the surface; reserved in both two-up layouts
 *  so switching Wipe → Blend does not resize the picture. */
const BLEND_BAR_H = 30;

export interface StageProps {
  lanes: LaneView[];
  /** Shot-relative path → `/content/…` URL. */
  urlFor: (path: string | null, revision: number) => string | null;
  clock: Clock;
  aspect: number;
  layout: LayoutId;
  onLayout: (layout: LayoutId) => void;
  laneA: LaneId;
  laneB: LaneId;
  onLaneA: (lane: LaneId) => void;
  onLaneB: (lane: LaneId) => void;
  greyboxMode: GreyboxMode;
  onGreyboxMode: (mode: GreyboxMode) => void;
  cameraMode: CameraMode;
  onCameraMode: (mode: CameraMode) => void;
  glbUrl: string | null;
  meta: SceneMeta | null;
  takes: Take[];
  onSelectTake: (id: string) => void;
  mutedTakes: boolean;
  onToggleMuted: () => void;
  onLoadedChange: (laneId: string, loaded: boolean, error: string | null) => void;
}

export function Stage(props: StageProps) {
  const { lanes, layout, laneA, laneB, aspect } = props;
  const shown = visibleLanes(lanes, layout, laneA, laneB);
  const a = shown[0] ?? null;
  const b = layout === "wipe" || layout === "blend" ? (shown[1] ?? null) : null;

  const boxRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = boxRef.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      setBox({ width: rect.width, height: rect.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const { direction, laneWidth } = planSideLayout(box.width, box.height, aspect, lanes.length, {
    padding: STAGE_PADDING,
    gap: LANE_GAP,
    header: LANE_HEADER_H,
  });
  // A two-up card is one aspect-ratio surface plus one header row; sized by
  // width alone it would be clipped at the bottom of a short pane.
  const overlayWidth = Math.max(
    240,
    Math.min(
      box.width - STAGE_PADDING,
      Math.max(0, box.height - STAGE_PADDING - LANE_HEADER_H - BLEND_BAR_H) * aspect,
    ),
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <LayoutBar {...props} />
      <div ref={boxRef} className="min-h-0 flex-1 p-2">
        {lanes.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-cc-muted">
            This shot has no lanes yet.
          </div>
        ) : layout === "side" ? (
          // Centred, not stretched: a lane is a 16:9 picture, and a card that
          // filled a tall pane would be four fifths letterbox.
          <div
            className={`flex h-full min-h-0 items-center justify-center gap-2 ${
              direction === "column" ? "flex-col" : "flex-row"
            }`}
          >
            {lanes.map((lane) => (
              <LaneCard
                key={lane.id}
                lane={lane}
                active
                fixedWidth={laneWidth}
                {...props}
              />
            ))}
          </div>
        ) : layout === "solo" ? (
          a ? (
            <div className="flex h-full min-h-0 items-center justify-center">
              <LaneCard lane={a} active {...props} />
            </div>
          ) : null
        ) : (
          <div className="flex h-full min-h-0 items-center justify-center">
            <OverlayPair a={a} b={b} mode={layout} width={overlayWidth} {...props} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Controls ────────────────────────────────────────────────────────────────

function LayoutBar({
  lanes,
  layout,
  onLayout,
  laneA,
  laneB,
  onLaneA,
  onLaneB,
}: StageProps) {
  const twoUp = layout === "wipe" || layout === "blend";
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-cc-border bg-cc-surface/30 px-3 py-1.5 backdrop-blur">
      <span className="text-[10px] uppercase tracking-wide text-cc-muted">Layout</span>
      <div className="flex items-center gap-1">
        {LAYOUT_IDS.map((id) => (
          <Segment key={id} active={layout === id} onClick={() => onLayout(id)}>
            {LAYOUT_LABEL[id]}
          </Segment>
        ))}
      </div>
      {twoUp || layout === "solo" ? (
        <>
          <span className="mx-1 h-3.5 w-px bg-cc-border" />
          <span className="text-[10px] uppercase tracking-wide text-cc-muted">
            {twoUp ? "A over B" : "Lane"}
          </span>
          <div className="flex items-center gap-1">
            {lanes.map((lane) => (
              <Segment key={lane.id} active={laneA === lane.id} onClick={() => onLaneA(lane.id)}>
                {lane.label}
              </Segment>
            ))}
          </div>
          {twoUp ? (
            <>
              <span className="text-[10px] text-cc-muted">over</span>
              <div className="flex items-center gap-1">
                {lanes.map((lane) => (
                  <Segment
                    key={lane.id}
                    active={laneB === lane.id}
                    onClick={() => onLaneB(lane.id)}
                  >
                    {lane.label}
                  </Segment>
                ))}
              </div>
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

// ── Lane card (side / solo) ─────────────────────────────────────────────────

function LaneCard({
  lane,
  active,
  fixedWidth = null,
  ...props
}: StageProps & { lane: LaneView; active: boolean; fixedWidth?: number | null }) {
  return (
    <section
      className={`flex max-h-full min-w-0 flex-col overflow-hidden rounded-md border border-cc-border bg-cc-card ${
        fixedWidth === null ? "flex-1" : "shrink-0"
      }`}
      style={fixedWidth === null ? undefined : { width: fixedWidth }}
    >
      <LaneHeader lane={lane} {...headerProps(lane, props)} />
      {/* The media box takes the SHOT's aspect so the card is as tall as the
          picture is. `object-contain` inside still guarantees the frame is
          never distorted when the ratio has to be clamped. */}
      <div className="min-h-0 w-full" style={{ aspectRatio: `${props.aspect}` }}>
        <LaneSurface
          lane={lane}
          url={props.urlFor(lane.file, lane.revision)}
          clock={props.clock}
          active={active}
          muted={lane.id === "take" ? props.mutedTakes : true}
          greyboxMode={props.greyboxMode}
          cameraMode={props.cameraMode}
          glbUrl={props.glbUrl}
          meta={props.meta}
          aspect={props.aspect}
          onLoadedChange={props.onLoadedChange}
        />
      </div>
    </section>
  );
}

function headerProps(lane: LaneView, props: StageProps) {
  if (lane.id === "greybox") {
    return {
      greyboxMode: props.greyboxMode,
      onGreyboxMode: props.onGreyboxMode,
      cameraMode: props.cameraMode,
      onCameraMode: props.onCameraMode,
      hasGlb: props.glbUrl !== null,
    };
  }
  if (lane.id === "take") {
    return {
      takeOptions: props.takes.map((t) => ({
        id: t.id,
        label: takeLabel(t.id),
        status: t.status,
      })),
      onSelectTake: props.onSelectTake,
      muted: props.mutedTakes,
      onToggleMuted: props.onToggleMuted,
    };
  }
  return {};
}

// ── Wipe / Blend ────────────────────────────────────────────────────────────

function OverlayPair({
  a,
  b,
  mode,
  width,
  ...props
}: StageProps & {
  a: LaneView | null;
  b: LaneView | null;
  mode: "wipe" | "blend";
  width: number;
}) {
  const [split, setSplit] = useState(0.5);
  const dragging = useRef(false);
  const surfaceRef = useRef<HTMLDivElement | null>(null);

  const positionFrom = useCallback((clientX: number) => {
    const box = surfaceRef.current?.getBoundingClientRect();
    if (!box || box.width === 0) return 0.5;
    return clamp((clientX - box.left) / box.width, 0, 1);
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (mode !== "wipe") return;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        /* capture is an optimization; the drag works without it */
      }
      // Whether the drag is live is OUR state, not `hasPointerCapture()`:
      // a failed capture would otherwise freeze the divider under a pointer
      // that is visibly still moving.
      dragging.current = true;
      setSplit(positionFrom(event.clientX));
    },
    [mode, positionFrom],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging.current) return;
      setSplit(positionFrom(event.clientX));
    },
    [positionFrom],
  );

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* never captured, or already released */
    }
  }, []);

  if (!a) return null;

  return (
    <section
      className="flex max-h-full min-h-0 shrink-0 flex-col overflow-hidden rounded-md border border-cc-border bg-cc-card"
      style={{ width }}
    >
      <div className="flex shrink-0 divide-x divide-cc-border">
        <div className="min-w-0 flex-1">
          <LaneHeader lane={a} {...headerProps(a, props)} />
        </div>
        {b && b.id !== a.id ? (
          <div className="min-w-0 flex-1">
            <LaneHeader lane={b} {...headerProps(b, props)} />
          </div>
        ) : null}
      </div>

      <div
        ref={surfaceRef}
        className="relative min-h-0 w-full bg-black/60"
        style={{ aspectRatio: `${props.aspect}` }}
      >
        {b && b.id !== a.id ? (
          <div className="absolute inset-0">
            <LaneSurface
              lane={b}
              url={props.urlFor(b.file, b.revision)}
              clock={props.clock}
              active
              muted={b.id === "take" ? props.mutedTakes : true}
              greyboxMode={props.greyboxMode}
              cameraMode={props.cameraMode}
              glbUrl={props.glbUrl}
              meta={props.meta}
              aspect={props.aspect}
              onLoadedChange={props.onLoadedChange}
            />
          </div>
        ) : null}

        <div
          className="absolute inset-0"
          style={
            mode === "wipe"
              ? { clipPath: `inset(0 ${(1 - split) * 100}% 0 0)` }
              : { opacity: split }
          }
        >
          <LaneSurface
            lane={a}
            url={props.urlFor(a.file, a.revision)}
            clock={props.clock}
            active
            muted={a.id === "take" ? props.mutedTakes : true}
            greyboxMode={props.greyboxMode}
            cameraMode={props.cameraMode}
            glbUrl={props.glbUrl}
            meta={props.meta}
            aspect={props.aspect}
            onLoadedChange={props.onLoadedChange}
          />
        </div>

        {mode === "wipe" ? (
          <div
            className="absolute inset-0 cursor-ew-resize touch-none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            role="presentation"
          >
            <div
              className="absolute inset-y-0 w-px bg-cc-primary/80"
              style={{ left: `${split * 100}%` }}
            >
              <span className="absolute left-1/2 top-1/2 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-cc-primary/60 bg-cc-surface/90 text-cc-primary backdrop-blur">
                <svg
                  viewBox="0 0 24 24"
                  width={13}
                  height={13}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="m9 7-5 5 5 5M15 7l5 5-5 5" />
                </svg>
              </span>
            </div>
          </div>
        ) : null}
      </div>

      {mode === "blend" ? (
        <div className="flex shrink-0 items-center gap-2 border-t border-cc-border px-3 py-1.5">
          <span className="text-[10px] uppercase tracking-wide text-cc-muted">{a.label}</span>
          <BlendSlider value={split} onChange={setSplit} />
          <span className="text-[10px] uppercase tracking-wide text-cc-muted">
            {b?.label ?? "—"}
          </span>
          <span className="w-9 text-right text-[10px] tabular-nums text-cc-muted">
            {Math.round(split * 100)}%
          </span>
        </div>
      ) : null}
    </section>
  );
}

/**
 * A custom slider. A bare `<input type="range">` renders OS-native chrome
 * that clashes with the theme — the repository's frontend rule bans it in
 * every user-facing surface.
 */
function BlendSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);

  const set = (clientX: number) => {
    const box = trackRef.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    onChange(clamp((clientX - box.left) / box.width, 0, 1));
  };

  return (
    <div
      ref={trackRef}
      className="relative h-4 flex-1 cursor-pointer touch-none"
      role="slider"
      aria-label="Blend the two lanes"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      tabIndex={0}
      onPointerDown={(e) => {
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* optimization only */
        }
        dragging.current = true;
        set(e.clientX);
      }}
      onPointerMove={(e) => {
        if (dragging.current) set(e.clientX);
      }}
      onPointerUp={(e) => {
        dragging.current = false;
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
          /* already released */
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") onChange(clamp(value - 0.05, 0, 1));
        if (e.key === "ArrowRight") onChange(clamp(value + 0.05, 0, 1));
      }}
    >
      <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-cc-border" />
      <div
        className="absolute left-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-cc-primary/70"
        style={{ width: `${value * 100}%` }}
      />
      <span
        className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-cc-primary bg-cc-surface"
        style={{ left: `${value * 100}%` }}
      />
    </div>
  );
}

export default Stage;
