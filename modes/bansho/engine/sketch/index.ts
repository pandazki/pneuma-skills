/**
 * Hand-drawn sketch geometry (T3, prototype-ported verbatim) — the single
 * source of every jittered path: axes, grids, data curves, ink gestures,
 * separators.
 *
 * Layering (G2): engine core — ZERO imports. Every generator returns ONE
 * drawable path string (single `M`) so the stroke strategy can drive it
 * with dashoffset; this is precisely why rough.js was rejected (it draws
 * every line twice across multiple `<path>`es — 设计稿 §6.3).
 *
 * Determinism: all jitter flows from a caller-supplied seeded PRNG
 * (mulberry32). `Math.random()` is banned here — unseeded jitter makes
 * lines jump on every scrub-back re-render.
 */

/** A seeded pseudo-random stream in [0, 1). */
export type Rand = () => number;

/** mulberry32 — tiny, high-quality-enough, byte-deterministic PRNG. */
export function mulberry32(seed: number): Rand {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Point list → one quadratic-bezier path. The pen passes THROUGH every
 * input point; the hand-drawn wobble rides the control points (midpoint
 * ± amp × 2.2), so amplitude never accumulates along the stroke.
 */
export function sketchPath(
  pts: ReadonlyArray<readonly [number, number]>,
  rnd: Rand,
  amp: number,
): string {
  let d = `M ${pts[0]![0].toFixed(2)} ${pts[0]![1].toFixed(2)}`;
  for (let i = 1; i < pts.length; i++) {
    const [x, y] = pts[i]!;
    const [px, py] = pts[i - 1]!;
    const cx = (px + x) / 2 + (rnd() - 0.5) * amp * 2.2;
    const cy = (py + y) / 2 + (rnd() - 0.5) * amp * 2.2;
    d += ` Q ${cx.toFixed(2)} ${cy.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  return d;
}

/**
 * A hand-drawn straight line: ~1 waypoint per 46px (min 2 segments), with
 * endpoint jitter damped to 30% so the line lands where it aims.
 */
export function jitterLine(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rnd: Rand,
  amp = 1.5,
): string {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const segs = Math.max(2, Math.round(len / 46));
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const edge = i === 0 || i === segs ? 0.3 : 1;
    pts.push([
      x1 + (x2 - x1) * t + (rnd() - 0.5) * amp * 2 * edge,
      y1 + (y2 - y1) * t + (rnd() - 0.5) * amp * 2 * edge,
    ]);
  }
  return sketchPath(pts, rnd, amp * 0.5);
}

/**
 * A hand-drawn ellipse: polar sampling with ±5% radius wobble and a random
 * start angle, overshooting the full turn by two samples so the stroke
 * overlaps its own beginning — the way a real pen closes a circle.
 */
export function jitterEllipse(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rnd: Rand,
  amp = 2.4,
): string {
  const n = 16;
  const start = rnd() * 1.2;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= n + 2; i++) {
    const a = start + (i / n) * Math.PI * 2;
    const k = 1 + (rnd() - 0.5) * 0.05;
    pts.push([
      cx + Math.cos(a) * rx * k + (rnd() - 0.5) * amp,
      cy + Math.sin(a) * ry * k + (rnd() - 0.5) * amp,
    ]);
  }
  return sketchPath(pts, rnd, amp * 0.5);
}

/**
 * A hand-drawn box: the four edges drawn as ONE continuous stroke, and the
 * pen OVERSHOOTS the corner it started from.
 *
 * The overshoot is the detail that makes a drawn box read as drawn: a hand
 * closing a rectangle never lands exactly back on its own first corner, it
 * runs a little past. Without it the shape is too regular — the same note
 * the product owner made about the highlighter ("形状太规整"). Single `M`
 * by construction, because the stroke strategy drives one dashoffset over
 * one path.
 *
 * Corner jitter is damped like `jitterLine`'s endpoints (0.3): a box whose
 * corners wander reads as a blob, while wander along the EDGES reads as a
 * hand.
 */
export function jitterRect(
  x: number,
  y: number,
  w: number,
  h: number,
  rnd: Rand,
  amp = 1.6,
): string {
  const corner = (cx: number, cy: number): [number, number] => [
    cx + (rnd() - 0.5) * amp * 0.6,
    cy + (rnd() - 0.5) * amp * 0.6,
  ];
  const tl = corner(x, y);
  const tr = corner(x + w, y);
  const br = corner(x + w, y + h);
  const bl = corner(x, y + h);
  // Two waypoints per edge so the line breathes between the corners.
  const edge = (
    a: readonly [number, number],
    b: readonly [number, number],
  ): Array<[number, number]> => {
    const out: Array<[number, number]> = [];
    for (const t of [0.34, 0.68]) {
      out.push([
        a[0] + (b[0] - a[0]) * t + (rnd() - 0.5) * amp * 2,
        a[1] + (b[1] - a[1]) * t + (rnd() - 0.5) * amp * 2,
      ]);
    }
    out.push([b[0], b[1]]);
    return out;
  };
  // 收笔过冲 — past the start corner, along the edge it arrived on.
  const overshoot: [number, number] = [
    tl[0] + Math.min(w * 0.16, amp * 5 + 2),
    tl[1] + (rnd() - 0.5) * amp,
  ];
  const pts: Array<[number, number]> = [
    tl,
    ...edge(tl, tr),
    ...edge(tr, br),
    ...edge(br, bl),
    ...edge(bl, tl),
    overshoot,
  ];
  return sketchPath(pts, rnd, amp * 0.5);
}

/**
 * A hand-drawn arrow: the shaft and both barbs of the head composed into
 * ONE path, drawn from the start point through to the tip and back out
 * along each barb. The sense of direction comes from the path's own
 * direction — the pen arrives at the target — which is why this is a single
 * stroke and not a shaft plus an SVG `marker-end`: a marker would pop into
 * existence fully formed while the shaft was still being drawn, and could
 * not be driven by the one dashoffset the stroke strategy owns.
 *
 * The tip is placed EXACTLY where the caller asked (no jitter on the last
 * shaft point): the caller clipped it to the target box's boundary, and an
 * arrow that wanders is an arrow that either pokes into the box or floats
 * short of it.
 */
export function jitterArrow(
  route: ReadonlyArray<readonly [number, number]>,
  rnd: Rand,
  amp = 1.4,
): string {
  // The route is a POLYLINE, not two endpoints: an arrow that skips a rank
  // has to travel through the corridor the layout reserved for it, or it
  // cuts straight across the boxes in between (measured: a→d over b, c
  // crossed b). A two-point route is the straight case.
  const shaft: Array<[number, number]> = [];
  const last = route.length - 1;
  for (let s = 1; s <= last; s++) {
    const [ax, ay] = route[s - 1]!;
    const [bx, by] = route[s]!;
    const segLen = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.round(segLen / 46));
    for (let i = s === 1 ? 0 : 1; i <= steps; i++) {
      const t = i / steps;
      // Endpoint jitter damped (`jitterLine`'s 0.3), and ZERO at the tip:
      // the caller clipped it to the target's boundary, and an arrow that
      // wanders either pokes into the box or floats short of it.
      const atTip = s === last && i === steps;
      const atTail = s === 1 && i === 0;
      const edge = atTip ? 0 : atTail ? 0.3 : 1;
      shaft.push([
        ax + (bx - ax) * t + (rnd() - 0.5) * amp * 2 * edge,
        ay + (by - ay) * t + (rnd() - 0.5) * amp * 2 * edge,
      ]);
    }
  }
  const [tx, ty] = route[last]!;
  const [px, py] = route[last - 1] ?? route[last]!;
  const dx = tx - px;
  const dy = ty - py;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  // The head: back off along the last segment, out to one side, back to the
  // tip, out to the other — the way a hand flicks two strokes onto an arrow.
  const head = Math.min(13, Math.max(7, len * 0.28));
  const spread = head * 0.46;
  const barb = (side: 1 | -1): [number, number] => [
    tx - ux * head - uy * spread * side + (rnd() - 0.5) * amp,
    ty - uy * head + ux * spread * side + (rnd() - 0.5) * amp,
  ];
  return sketchPath([...shaft, barb(1), [tx, ty], barb(-1)], rnd, amp * 0.4);
}

/**
 * G8-I — the highlighter is a FILLED shape, never a uniform stroke (uniform
 * width + round caps reads as a sticker: "形状太规整"). One swept band:
 * narrow entry → full belly → tapered exit (sine envelope), whole band
 * randomly lifted and tilted, top and bottom edges bleeding unevenly.
 * Reveal is a left-to-right clip window (the wipe strategy) — exactly the
 * motion of the pen sweeping across.
 *
 * `h` is the NIB WIDTH: the belly is exactly `h`, and every deviation from
 * it is a marker's unevenness on the OUTSIDE of that core. The edge wobble
 * is therefore one-sided — a nib lays its full width down and the ink
 * bleeds past it; it does not eat back into the stroke. That is not a
 * stylistic preference but the reason the band can be trusted to cover the
 * writing (G8-M): with two-sided wobble, whether a CJK glyph's top stayed
 * inside the yellow came down to a coin flip in the seed.
 *
 * The envelope's floor is half the nib rather than a third, and its
 * shoulder is sharper (exponent 0.22), so the band reaches near-full within
 * the first tenth of its length. On a CJK run the old numbers spent a whole
 * character landing and another lifting, and those two characters were the
 * ones left standing outside the band.
 */
export function highlighterShape(
  x0: number,
  x1: number,
  cy: number,
  h: number,
  rnd: Rand,
): string {
  const n = 12;
  const top: Array<[number, number]> = [];
  const bot: Array<[number, number]> = [];
  const lift = (rnd() - 0.5) * h * 0.05;
  const tilt = (rnd() - 0.5) * h * 0.12;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = x0 + (x1 - x0) * t;
    const mid = cy + lift + tilt * (t - 0.5) * 2;
    const env = Math.pow(Math.sin(Math.PI * clamp01(t * 1.08 - 0.04)), 0.22);
    const w = h * (0.5 + 0.5 * env);
    top.push([x, mid - w / 2 - rnd() * h * 0.05]);
    bot.push([x, mid + w / 2 + rnd() * h * 0.06]);
  }
  const rev = bot.reverse();
  let d = sketchPath(top, rnd, h * 0.05);
  d += ` L ${rev[0]![0].toFixed(2)} ${rev[0]![1].toFixed(2)}`;
  d += sketchPath(rev, rnd, h * 0.05).replace(/^M [-\d.]+ [-\d.]+/, "");
  return d + " Z";
}
