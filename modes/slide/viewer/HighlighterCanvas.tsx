/**
 * HighlighterCanvas — transparent canvas overlay for freehand highlighter drawing.
 *
 * Renders over the slide sizer div. User draws with yellow semi-transparent strokes.
 * On pointer up, computes the bounding box of all drawn points (expanded by 10%),
 * clamps to virtual slide dimensions, and calls onComplete with the region.
 *
 * Two modes:
 * - drawing=true: pointer events active, cursor=crosshair
 * - drawing=false: display only (shows strokes), pointer-events=none
 */

import { useRef, useEffect, useCallback } from "react";

interface Props {
  width: number;       // scaledW (canvas pixel size)
  height: number;      // scaledH (canvas pixel size)
  zoomScale: number;   // current zoom factor
  virtualW: number;    // full slide width in virtual pixels
  virtualH: number;    // full slide height in virtual pixels
  drawing: boolean;    // whether pointer events are active
  onComplete: (region: { x: number; y: number; width: number; height: number }, strokesDataUrl?: string) => void;
}

const STROKE_COLOR = "rgba(255, 230, 0, 0.4)";
const STROKE_WIDTH_VIRTUAL = 20; // stroke width at virtual resolution

/** Draw a smooth curve through all points using quadratic Bézier via midpoints */
function drawSmoothPath(
  ctx: CanvasRenderingContext2D,
  points: { x: number; y: number }[],
  lineWidth: number,
) {
  if (points.length < 2) return;

  ctx.strokeStyle = STROKE_COLOR;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);

  if (points.length === 2) {
    ctx.lineTo(points[1].x, points[1].y);
  } else {
    // Use quadratic curves through midpoints for smoothness
    for (let i = 1; i < points.length - 1; i++) {
      const midX = (points[i].x + points[i + 1].x) / 2;
      const midY = (points[i].y + points[i + 1].y) / 2;
      ctx.quadraticCurveTo(points[i].x, points[i].y, midX, midY);
    }
    // Final segment to last point
    const last = points[points.length - 1];
    ctx.lineTo(last.x, last.y);
  }

  ctx.stroke();
}

export default function HighlighterCanvas({
  width,
  height,
  zoomScale,
  virtualW,
  virtualH,
  drawing,
  onComplete,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const pointsRef = useRef<{ x: number; y: number }[]>([]);
  // Screen-space points for redrawing the smooth path each frame
  const screenPointsRef = useRef<{ x: number; y: number }[]>([]);

  // Set up canvas resolution
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(dpr, dpr);
    }
  }, [width, height]);

  const getVirtualCoords = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      const canvasX = e.clientX - rect.left;
      const canvasY = e.clientY - rect.top;
      return {
        x: canvasX / zoomScale,
        y: canvasY / zoomScale,
      };
    },
    [zoomScale],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drawing) return;
      e.preventDefault();
      e.stopPropagation();
      const canvas = canvasRef.current;
      if (!canvas) return;

      // Clear previous strokes when starting a new draw
      const dpr = window.devicePixelRatio || 1;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }

      drawingRef.current = true;
      pointsRef.current = [];
      screenPointsRef.current = [];
      canvas.setPointerCapture(e.pointerId);

      const vCoord = getVirtualCoords(e);
      pointsRef.current.push(vCoord);

      const rect = canvas.getBoundingClientRect();
      screenPointsRef.current.push({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    },
    [drawing, getVirtualCoords],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drawingRef.current) return;
      e.preventDefault();
      e.stopPropagation();

      const canvas = canvasRef.current;
      if (!canvas) return;

      const vCoord = getVirtualCoords(e);
      pointsRef.current.push(vCoord);

      const rect = canvas.getBoundingClientRect();
      screenPointsRef.current.push({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });

      // Clear and redraw entire path to avoid alpha overlap artifacts
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, width, height);
        drawSmoothPath(ctx, screenPointsRef.current, STROKE_WIDTH_VIRTUAL * zoomScale);
      }
    },
    [getVirtualCoords, zoomScale, width, height],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drawingRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      drawingRef.current = false;

      const points = pointsRef.current;
      if (points.length < 2) {
        const canvas = canvasRef.current;
        if (canvas) {
          const ctx = canvas.getContext("2d");
          ctx?.clearRect(0, 0, canvas.width, canvas.height);
        }
        return;
      }

      // Compute bounding box from virtual coordinates
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of points) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }

      // Expand by 10%
      const bw = maxX - minX;
      const bh = maxY - minY;
      const expandX = bw * 0.1;
      const expandY = bh * 0.1;
      minX -= expandX;
      minY -= expandY;
      maxX += expandX;
      maxY += expandY;

      // Auto-expand thin strokes (e.g. a straight horizontal/vertical line)
      // to a useful capture region
      const MIN_DIM = 80; // minimum dimension in virtual pixels
      const curW = maxX - minX;
      const curH = maxY - minY;
      if (curH < MIN_DIM && curW >= MIN_DIM) {
        // Horizontal line → expand upward
        minY = minY - (MIN_DIM - curH);
      } else if (curW < MIN_DIM && curH >= MIN_DIM) {
        // Vertical line → expand rightward
        maxX = maxX + (MIN_DIM - curW);
      } else if (curW < MIN_DIM && curH < MIN_DIM) {
        // Tiny region → expand both
        minY = minY - (MIN_DIM - curH);
        maxX = maxX + (MIN_DIM - curW);
      }

      // Clamp to virtual slide dimensions
      minX = Math.max(0, minX);
      minY = Math.max(0, minY);
      maxX = Math.min(virtualW, maxX);
      maxY = Math.min(virtualH, maxY);

      const region = {
        x: Math.round(minX),
        y: Math.round(minY),
        width: Math.round(maxX - minX),
        height: Math.round(maxY - minY),
      };

      // Ensure minimum region size
      if (region.width < 10 || region.height < 10) {
        const canvas = canvasRef.current;
        if (canvas) {
          const ctx = canvas.getContext("2d");
          ctx?.clearRect(0, 0, canvas.width, canvas.height);
        }
        return;
      }

      // Extract strokes for this region as a PNG data URL
      let strokesDataUrl: string | undefined;
      const canvas = canvasRef.current;
      if (canvas) {
        try {
          const dpr = window.devicePixelRatio || 1;
          const extractCanvas = document.createElement("canvas");
          extractCanvas.width = region.width;
          extractCanvas.height = region.height;
          const extractCtx = extractCanvas.getContext("2d");
          if (extractCtx) {
            // Source rect in canvas pixel space (region is in virtual coords)
            const sx = region.x * zoomScale * dpr;
            const sy = region.y * zoomScale * dpr;
            const sw = region.width * zoomScale * dpr;
            const sh = region.height * zoomScale * dpr;
            extractCtx.drawImage(canvas, sx, sy, sw, sh, 0, 0, region.width, region.height);
            strokesDataUrl = extractCanvas.toDataURL("image/png");
          }
        } catch { /* ignore extraction failures */ }
      }

      // Keep strokes visible — don't clear canvas
      onComplete(region, strokesDataUrl);
    },
    [virtualW, virtualH, onComplete, zoomScale],
  );

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width,
        height,
        cursor: drawing ? "crosshair" : "default",
        zIndex: 40,
        touchAction: "none",
        pointerEvents: drawing ? "auto" : "none",
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    />
  );
}
