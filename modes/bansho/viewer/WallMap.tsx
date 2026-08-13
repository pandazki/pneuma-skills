/**
 * WallMap.tsx — the room, seen from the back of the hall.
 *
 * The product owner's verdict on the widget this replaces: 「总览肯定不是
 * 右上角的控件，是一个类似无限画布的缩略图。可以缩放拖拽去观测的，并且能看到
 * 黑板中内容的轮廓形状。」 A row of fill bars answers "how full is board 3";
 * a reader standing in a room asks "which board has the diagram, and where
 * am I looking right now". So this is a MAP: the whole wall drawn to scale,
 * with the real shape of the writing on every board (`wall-outline.ts`),
 * the camera's own rectangle on top of it, and the three gestures an
 * infinite canvas has — drag to pan the real stage, wheel to zoom the map,
 * click a board to go and stand in front of it.
 *
 * THE COORDINATE TRICK, and why there is no scale arithmetic below: the
 * map's `<svg>` carries a `viewBox` in BOARD PIXELS. Every board is placed
 * at its `wallSlot`, every outline is drawn in its panel's own coordinates,
 * and the viewport rectangle is written in board px too. The browser does
 * the projection. Zooming the map is a viewBox change and nothing else.
 *
 * WHAT RUNS WHEN (the same split as `applyDepth`), now in three rates
 * rather than two:
 *   - the GEOMETRY is COMPILE-rate React state, handed down as props;
 *   - WHICH of it is drawn follows the playhead at STEP rate
 *     (`revealIndex`) — the map shows what is written right now, never the
 *     end of the lecture (defect W4a-1);
 *   - "you are here" and the viewport rectangle are written IMPERATIVELY by
 *     the host's `applyCamera`, through the two refs it owns — a setState
 *     on the camera's hot path would re-render the viewer on every frame of
 *     every glide.
 *
 * G8-J: this component takes NO rect readings. Panning uses pointer
 * deltas, the wheel uses `offsetX/offsetY` against `clientWidth/Height`
 * (layout values), and choosing a board is a click handler on that board's
 * own `<rect>`. There is nothing here for the funnel to own.
 */

import { useCallback, useRef, useState, type PointerEvent, type WheelEvent } from "react";

import { wallExtent, wallSlot, type WallGeometry } from "../engine/wall.js";
import { groupDrawnAt, type PanelOutline } from "./wall-outline.js";

export interface WallMapProps {
  panelCount: number;
  geom: WallGeometry;
  /** Per board, in board order; may be shorter than `panelCount` before
   *  the first outline read lands. */
  outlines: readonly PanelOutline[];
  /**
   * The playhead, as the active SCHEDULE INDEX — what is written right
   * now. It is deliberately not the clock: the index changes once per
   * reveal unit where the clock changes sixty times a second, so the map
   * re-renders at the rate the writing actually changes and the frame loop
   * never touches React. (The viewport rectangle is the one thing that
   * legitimately follows the camera, and the host writes that one
   * imperatively — see `registerViewRect`.)
   */
  revealIndex: number;
  /** The host's board `<rect>` registry — `markWallMap` stamps
   *  `data-current` on one of them from the camera's hot path. */
  registerBoard: (panel: number, el: SVGRectElement | null) => void;
  /** The host's viewport-rectangle ref — `applyCamera` writes x/y/w/h. */
  registerViewRect: (el: SVGRectElement | null) => void;
  /** Stand in front of board `panel` (the host's `jumpToBoard`). */
  onJump: (panel: number) => void;
  /** Drag the map: move the real camera by this many BOARD px. */
  onPanBoard: (dx: number, dy: number) => void;
}

/** The map's drawn width in CSS px when expanded. Its height follows the
 *  wall's own aspect ratio — a map of a 2x2 room is nearly square, a map
 *  of a two-board wall is a letterbox, and that shape is itself
 *  information about the room. */
const MAP_W = 236;
/** Never let the map get so tall it becomes a second viewer. */
const MAP_MAX_H = 260;

/** Map zoom bounds: 1 is "the whole wall", and past 4x a board's writing
 *  is legible enough that the reader should be looking at the board. */
const MAP_MIN_Z = 1;
const MAP_MAX_Z = 4;

/** Past this the press is a pan, not a click on a board — the same slop
 *  rule the stage grab uses, for the same reason. */
const MAP_SLOP = 3;

export default function WallMap({
  panelCount,
  geom,
  outlines,
  revealIndex,
  registerBoard,
  registerViewRect,
  onJump,
  onPanBoard,
}: WallMapProps): React.ReactElement | null {
  const [open, setOpen] = useState(true);
  /** The map's own camera, as a viewBox over the wall. */
  const [view, setView] = useState<{ x: number; y: number; z: number }>({
    x: 0,
    y: 0,
    z: 1,
  });
  const dragRef = useRef<{
    pointerId: number;
    lastX: number;
    lastY: number;
    /** Board px per CSS px — the map's own scale, from layout values. */
    perPx: number;
    moved: boolean;
  } | null>(null);
  /** A pan swallows the click that ends it (stage-grab discipline). */
  const pannedRef = useRef(false);

  // Hooks first, unconditionally: the degenerate-geometry bail-out lives
  // at the bottom (a board that has not been measured yet renders no map,
  // and one frame later it does — an early return here would change the
  // hook count between those two renders).
  const wall = wallExtent(panelCount, geom);
  // `geom.panelW`, not the extent: before the first fold the panel width is
  // 0 and the extent is still a gap-sized rectangle, which would flash an
  // empty map square for one paint on every four-board lecture.
  const drawable = geom.panelW > 0 && wall.w > 0 && wall.h > 0;

  const cssW = MAP_W;
  const cssH = Math.min(MAP_MAX_H, Math.round((MAP_W * wall.h) / wall.w));

  const boxW = wall.w / view.z;
  const boxH = wall.h / view.z;
  const boxX = Math.min(Math.max(0, view.x), Math.max(0, wall.w - boxW));
  const boxY = Math.min(Math.max(0, view.y), Math.max(0, wall.h - boxH));

  const onWheel = useCallback(
    (event: WheelEvent<SVGSVGElement>): void => {
      event.preventDefault();
      event.stopPropagation();
      const el = event.currentTarget;
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!(w > 0) || !(h > 0)) return;
      // Anchored zoom: the wall point under the pointer stays under it.
      const nx = event.nativeEvent.offsetX / w;
      const ny = event.nativeEvent.offsetY / h;
      setView((prev) => {
        const z = Math.min(
          MAP_MAX_Z,
          Math.max(MAP_MIN_Z, prev.z * Math.exp(-event.deltaY / 400)),
        );
        if (z === prev.z) return prev;
        const prevW = wall.w / prev.z;
        const prevH = wall.h / prev.z;
        const px = prev.x + nx * prevW;
        const py = prev.y + ny * prevH;
        return { x: px - (nx * wall.w) / z, y: py - (ny * wall.h) / z, z };
      });
    },
    [wall.w, wall.h],
  );

  const onPointerDown = useCallback(
    (event: PointerEvent<SVGSVGElement>): void => {
      const el = event.currentTarget;
      if (!(el.clientWidth > 0)) return;
      // Capture is taken LATER, in `onPointerMove`, once the press has
      // travelled far enough to be a pan. Taking it here breaks the map's
      // other gesture outright: with the <svg> capturing, the pointerup
      // retargets to it, the browser then fires `click` on the common
      // ancestor instead of on the board's own <rect>, and clicking a
      // board silently stops working. (Measured, not reasoned: the rect
      // saw `pointerdown` and never saw `click`.)
      dragRef.current = {
        pointerId: event.pointerId,
        lastX: event.clientX,
        lastY: event.clientY,
        // One CSS px of map is this many board px — the viewBox width over
        // the element's layout width, both known without a rect read.
        perPx: boxW / el.clientWidth,
        moved: false,
      };
      pannedRef.current = false;
    },
    [boxW],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent<SVGSVGElement>): void => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const dx = event.clientX - drag.lastX;
      const dy = event.clientY - drag.lastY;
      if (!drag.moved && Math.hypot(dx, dy) < MAP_SLOP) return;
      if (!drag.moved) {
        // Now it is a pan: capture so a hand that leaves the map keeps
        // steering. A pointer id the browser does not know (a synthetic
        // event from a harness) throws here, and losing capture must not
        // lose the drag.
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // No capture available; the handlers below still fire.
        }
      }
      drag.moved = true;
      pannedRef.current = true;
      drag.lastX = event.clientX;
      drag.lastY = event.clientY;
      // Dragging the map moves the READER, not the map: the wall stays
      // put and the viewport rectangle follows the hand, which is what a
      // minimap's rectangle means everywhere else it exists.
      onPanBoard(dx * drag.perPx, dy * drag.perPx);
    },
    [onPanBoard],
  );

  const endDrag = useCallback((event: PointerEvent<SVGSVGElement>): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Capture was never taken (see `onPointerDown`).
    }
  }, []);

  if (!drawable) return null;

  return (
    <div
      className="absolute bottom-3 right-3 z-10 rounded-lg border border-cc-border/70 bg-cc-bg/75 p-1.5 backdrop-blur-md"
      data-testid="bansho-wall-map"
    >
      <div className="flex items-center justify-between gap-2 px-1 pb-1">
        <span className="text-[10px] font-medium uppercase tracking-wider text-cc-text-muted">
          Wall · {panelCount}
        </span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? "Collapse the wall map" : "Expand the wall map"}
          className="rounded p-0.5 text-cc-text-muted transition-colors hover:text-cc-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cc-primary/70"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path
              d={open ? "M2 4.5 L6 8.5 L10 4.5" : "M2 7.5 L6 3.5 L10 7.5"}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
      {open && (
        <svg
          role="group"
          aria-label={`Wall map, ${panelCount} boards`}
          width={cssW}
          height={cssH}
          viewBox={`${boxX} ${boxY} ${boxW} ${boxH}`}
          preserveAspectRatio="xMidYMid meet"
          className="bansho-map block cursor-grab touch-none rounded-[3px] active:cursor-grabbing"
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          {Array.from({ length: panelCount }, (_, i) => {
            const slot = wallSlot(i, panelCount, geom);
            const outline = outlines[i];
            return (
              <g key={i} transform={`translate(${slot.x} ${slot.y})`}>
                <rect
                  ref={(el) => registerBoard(i, el)}
                  className="bansho-map-board"
                  width={geom.panelW}
                  height={geom.panelH}
                  onClick={() => {
                    // The click that ends a pan is the reader letting go
                    // of the map, not choosing a board.
                    if (pannedRef.current) return;
                    onJump(i);
                  }}
                >
                  <title>{`Board ${i + 1} of ${panelCount}`}</title>
                </rect>
                {outline && (
                  <g className="bansho-map-ink" pointerEvents="none">
                    {/* Every group stays MOUNTED and is hidden by one
                        attribute: a step change then costs React a props
                        compare per group and a `display` write on the one
                        or two that crossed their window, instead of
                        tearing down and rebuilding four boards' worth of
                        <svg> every time the pen finishes a line. */}
                    {outline.groups.map((group, j) => (
                      <g
                        key={`${group.key} ${group.run ?? ""}`}
                        data-testid={`bansho-map-group-${j}`}
                        style={
                          groupDrawnAt(group, revealIndex)
                            ? undefined
                            : { display: "none" }
                        }
                      >
                        {group.bars.map((b, k) => (
                          <rect key={k} x={b.x} y={b.y} width={b.w} height={b.h} />
                        ))}
                        {group.strokes.map((s, k) => (
                          <svg
                            key={k}
                            x={s.x}
                            y={s.y}
                            width={s.w}
                            height={s.h}
                            viewBox={s.viewBox}
                            preserveAspectRatio="none"
                            overflow="visible"
                          >
                            {s.d.map((d, n) => (
                              <path key={n} d={d} />
                            ))}
                          </svg>
                        ))}
                      </g>
                    ))}
                  </g>
                )}
              </g>
            );
          })}
          {/* Where the camera stands. The host writes x/y/width/height on
              this element from `applyCamera` — never through React. */}
          <rect
            ref={registerViewRect}
            className="bansho-map-viewport"
            pointerEvents="none"
            width={0}
            height={0}
          />
        </svg>
      )}
    </div>
  );
}
