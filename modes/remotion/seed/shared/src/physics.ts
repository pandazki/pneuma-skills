// physics.ts — a small, deterministic 2D rigid-box solver for the mode-catalog scene.
//
// Why self-written: a render farm screenshots frames in separate browser tabs, so every
// frame must be computable on its own, synchronously, with no randomness. This module
// has no imports, no Math.random and no async loading: the same inputs always give the
// same trajectory, and `simulate()` bakes the whole scene once so any frame is a lookup.
//
// The algorithm follows Box2D-Lite (box-box clipping, sequential impulses with
// accumulated impulses and warm starting):
//   Copyright (c) 2006-2007 Erin Catto http://www.gphysics.com
//   Permission to use, copy, modify, distribute and sell this software and its
//   documentation for any purpose is hereby granted without fee, provided that the
//   above copyright notice appear in all copies. Erin Catto makes no representations
//   about the suitability of this software for any purpose. It is provided "as is"
//   without express or implied warranty.
//
// Units are arbitrary "world units"; the scene maps 1 unit to a fixed number of pixels.
// y points down (gravity is +y).

type V = { x: number; y: number };

type Body = {
  x: number;
  y: number;
  rot: number;
  vx: number;
  vy: number;
  w: number;
  hw: number; // half width
  hh: number; // half height
  invMass: number;
  invI: number;
  friction: number;
  id: number;
};

type Contact = {
  px: number;
  py: number;
  nx: number;
  ny: number;
  sep: number;
  pn: number;
  pt: number;
  massN: number;
  massT: number;
  bias: number;
  feature: number;
};

type Arbiter = { a: Body; b: Body; contacts: Contact[]; friction: number };

// Edge numbering for feature ids (so contacts persist across steps for warm starting).
const NO_EDGE = 0;
const EDGE1 = 1;
const EDGE2 = 2;
const EDGE3 = 3;
const EDGE4 = 4;

type Feature = { in1: number; out1: number; in2: number; out2: number };
type ClipVertex = { x: number; y: number; f: Feature };

const featureKey = (f: Feature) => f.in1 | (f.out1 << 4) | (f.in2 << 8) | (f.out2 << 12);
const flip = (f: Feature): Feature => ({ in1: f.in2, out1: f.out2, in2: f.in1, out2: f.out1 });

const ALLOWED_PENETRATION = 0.01;
const BIAS_FACTOR = 0.2;

function clipSegmentToLine(vIn: ClipVertex[], nx: number, ny: number, offset: number, clipEdge: number): ClipVertex[] {
  const out: ClipVertex[] = [];
  const d0 = nx * vIn[0].x + ny * vIn[0].y - offset;
  const d1 = nx * vIn[1].x + ny * vIn[1].y - offset;
  if (d0 <= 0) out.push(vIn[0]);
  if (d1 <= 0) out.push(vIn[1]);
  if (d0 * d1 < 0) {
    const t = d0 / (d0 - d1);
    const x = vIn[0].x + t * (vIn[1].x - vIn[0].x);
    const y = vIn[0].y + t * (vIn[1].y - vIn[0].y);
    if (d0 > 0) out.push({ x, y, f: { ...vIn[0].f, in1: clipEdge, in2: NO_EDGE } });
    else out.push({ x, y, f: { ...vIn[1].f, out1: clipEdge, out2: NO_EDGE } });
  }
  return out;
}

/** The incident edge of box (h, pos, rotation) against a reference normal. */
function incidentEdge(hx: number, hy: number, px: number, py: number, rot: number, nx: number, ny: number): ClipVertex[] {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  // n in the incident box's frame, flipped: -(R^T * normal)
  const lx = -(c * nx + s * ny);
  const ly = -(-s * nx + c * ny);
  let v: [number, number, number, number][]; // [x, y, in2, out2]
  if (Math.abs(lx) > Math.abs(ly)) {
    v = lx > 0
      ? [[hx, -hy, EDGE3, EDGE4], [hx, hy, EDGE4, EDGE1]]
      : [[-hx, hy, EDGE1, EDGE2], [-hx, -hy, EDGE2, EDGE3]];
  } else {
    v = ly > 0
      ? [[hx, hy, EDGE4, EDGE1], [-hx, hy, EDGE1, EDGE2]]
      : [[-hx, -hy, EDGE2, EDGE3], [hx, -hy, EDGE3, EDGE4]];
  }
  return v.map(([x, y, in2, out2]) => ({
    x: px + c * x - s * y,
    y: py + s * x + c * y,
    f: { in1: NO_EDGE, out1: NO_EDGE, in2, out2 },
  }));
}

/** Box-box contact manifold (0–2 points). The normal points from A to B. */
function collide(A: Body, B: Body): Contact[] {
  const cA = Math.cos(A.rot), sA = Math.sin(A.rot);
  const cB = Math.cos(B.rot), sB = Math.sin(B.rot);
  // Rotation matrices as columns: col1 = (c, s), col2 = (-s, c)
  const dpx = B.x - A.x, dpy = B.y - A.y;
  const dAx = cA * dpx + sA * dpy, dAy = -sA * dpx + cA * dpy;
  const dBx = cB * dpx + sB * dpy, dBy = -sB * dpx + cB * dpy;
  // C = RA^T * RB
  const c11 = cA * cB + sA * sB, c12 = -cA * sB + sA * cB;
  const c21 = -sA * cB + cA * sB, c22 = sA * sB + cA * cB;
  const a11 = Math.abs(c11), a12 = Math.abs(c12), a21 = Math.abs(c21), a22 = Math.abs(c22);

  const faceAx = Math.abs(dAx) - A.hw - (a11 * B.hw + a12 * B.hh);
  const faceAy = Math.abs(dAy) - A.hh - (a21 * B.hw + a22 * B.hh);
  if (faceAx > 0 || faceAy > 0) return [];
  const faceBx = Math.abs(dBx) - (a11 * A.hw + a21 * A.hh) - B.hw;
  const faceBy = Math.abs(dBy) - (a12 * A.hw + a22 * A.hh) - B.hh;
  if (faceBx > 0 || faceBy > 0) return [];

  const REL = 0.95, ABS = 0.01;
  let axis = 0;
  let sep = faceAx;
  let n: V = dAx > 0 ? { x: cA, y: sA } : { x: -cA, y: -sA };
  if (faceAy > REL * sep + ABS * A.hh) {
    axis = 1; sep = faceAy;
    n = dAy > 0 ? { x: -sA, y: cA } : { x: sA, y: -cA };
  }
  if (faceBx > REL * sep + ABS * B.hw) {
    axis = 2; sep = faceBx;
    n = dBx > 0 ? { x: cB, y: sB } : { x: -cB, y: -sB };
  }
  if (faceBy > REL * sep + ABS * B.hh) {
    axis = 3; sep = faceBy;
    n = dBy > 0 ? { x: -sB, y: cB } : { x: sB, y: -cB };
  }

  let fn: V, sn: V, front: number, negSide: number, posSide: number, negEdge: number, posEdge: number;
  let inc: ClipVertex[];
  if (axis === 0) {
    fn = n; front = A.x * fn.x + A.y * fn.y + A.hw;
    sn = { x: -sA, y: cA }; const side = A.x * sn.x + A.y * sn.y;
    negSide = -side + A.hh; posSide = side + A.hh; negEdge = EDGE3; posEdge = EDGE1;
    inc = incidentEdge(B.hw, B.hh, B.x, B.y, B.rot, fn.x, fn.y);
  } else if (axis === 1) {
    fn = n; front = A.x * fn.x + A.y * fn.y + A.hh;
    sn = { x: cA, y: sA }; const side = A.x * sn.x + A.y * sn.y;
    negSide = -side + A.hw; posSide = side + A.hw; negEdge = EDGE2; posEdge = EDGE4;
    inc = incidentEdge(B.hw, B.hh, B.x, B.y, B.rot, fn.x, fn.y);
  } else if (axis === 2) {
    fn = { x: -n.x, y: -n.y }; front = B.x * fn.x + B.y * fn.y + B.hw;
    sn = { x: -sB, y: cB }; const side = B.x * sn.x + B.y * sn.y;
    negSide = -side + B.hh; posSide = side + B.hh; negEdge = EDGE3; posEdge = EDGE1;
    inc = incidentEdge(A.hw, A.hh, A.x, A.y, A.rot, fn.x, fn.y);
  } else {
    fn = { x: -n.x, y: -n.y }; front = B.x * fn.x + B.y * fn.y + B.hh;
    sn = { x: cB, y: sB }; const side = B.x * sn.x + B.y * sn.y;
    negSide = -side + B.hw; posSide = side + B.hw; negEdge = EDGE2; posEdge = EDGE4;
    inc = incidentEdge(A.hw, A.hh, A.x, A.y, A.rot, fn.x, fn.y);
  }

  const clip1 = clipSegmentToLine(inc, -sn.x, -sn.y, negSide, negEdge);
  if (clip1.length < 2) return [];
  const clip2 = clipSegmentToLine(clip1, sn.x, sn.y, posSide, posEdge);
  if (clip2.length < 2) return [];

  const out: Contact[] = [];
  for (const cv of clip2) {
    const s = fn.x * cv.x + fn.y * cv.y - front;
    if (s <= 0) {
      out.push({
        px: cv.x - s * fn.x,
        py: cv.y - s * fn.y,
        nx: n.x,
        ny: n.y,
        sep: s,
        pn: 0,
        pt: 0,
        massN: 0,
        massT: 0,
        bias: 0,
        feature: featureKey(axis >= 2 ? flip(cv.f) : cv.f),
      });
    }
  }
  return out;
}

type BodyDef = {
  x: number;
  y: number;
  w: number; // full width
  h: number; // full height
  rot?: number;
  vx?: number;
  vy?: number;
  spin?: number;
  /** 0 = static */
  mass: number;
  friction?: number;
};

class World {
  bodies: Body[] = [];
  arbiters = new Map<string, Arbiter>();
  constructor(public gx: number, public gy: number, public iterations: number) {}

  add(d: BodyDef): Body {
    const hw = d.w / 2, hh = d.h / 2;
    const invMass = d.mass > 0 ? 1 / d.mass : 0;
    const I = d.mass > 0 ? (d.mass * (d.w * d.w + d.h * d.h)) / 12 : 0;
    const b: Body = {
      x: d.x, y: d.y, rot: d.rot ?? 0,
      vx: d.vx ?? 0, vy: d.vy ?? 0, w: d.spin ?? 0,
      hw, hh, invMass, invI: I > 0 ? 1 / I : 0,
      friction: d.friction ?? 0.5,
      id: this.bodies.length,
    };
    this.bodies.push(b);
    return b;
  }

  step(dt: number) {
    const invDt = dt > 0 ? 1 / dt : 0;
    const bs = this.bodies;

    // Broad phase: all pairs, in a fixed order. Cheap for a few dozen bodies.
    for (let i = 0; i < bs.length; i++) {
      for (let j = i + 1; j < bs.length; j++) {
        const a = bs[i], b = bs[j];
        if (a.invMass === 0 && b.invMass === 0) continue;
        // Bounding-circle reject before the exact test.
        const ra = a.hw + a.hh, rb = b.hw + b.hh;
        const dx = b.x - a.x, dy = b.y - a.y;
        const key = `${a.id}:${b.id}`;
        const fresh = dx * dx + dy * dy > (ra + rb) * (ra + rb) ? [] : collide(a, b);
        if (fresh.length === 0) {
          this.arbiters.delete(key);
          continue;
        }
        const old = this.arbiters.get(key);
        if (old) {
          // Warm start: carry accumulated impulses to matching features.
          for (const c of fresh) {
            const prev = old.contacts.find((o) => o.feature === c.feature);
            if (prev) {
              c.pn = prev.pn;
              c.pt = prev.pt;
            }
          }
          old.contacts = fresh;
        } else {
          this.arbiters.set(key, { a, b, contacts: fresh, friction: Math.sqrt(a.friction * b.friction) });
        }
      }
    }

    // Integrate forces.
    for (const b of bs) {
      if (b.invMass === 0) continue;
      b.vx += dt * this.gx;
      b.vy += dt * this.gy;
    }

    // Pre-step.
    for (const arb of this.arbiters.values()) {
      const { a, b } = arb;
      for (const c of arb.contacts) {
        const r1x = c.px - a.x, r1y = c.py - a.y;
        const r2x = c.px - b.x, r2y = c.py - b.y;
        const rn1 = r1x * c.nx + r1y * c.ny;
        const rn2 = r2x * c.nx + r2y * c.ny;
        const kN = a.invMass + b.invMass +
          a.invI * (r1x * r1x + r1y * r1y - rn1 * rn1) +
          b.invI * (r2x * r2x + r2y * r2y - rn2 * rn2);
        c.massN = 1 / kN;
        const tx = c.ny, ty = -c.nx;
        const rt1 = r1x * tx + r1y * ty;
        const rt2 = r2x * tx + r2y * ty;
        const kT = a.invMass + b.invMass +
          a.invI * (r1x * r1x + r1y * r1y - rt1 * rt1) +
          b.invI * (r2x * r2x + r2y * r2y - rt2 * rt2);
        c.massT = 1 / kT;
        c.bias = -BIAS_FACTOR * invDt * Math.min(0, c.sep + ALLOWED_PENETRATION);
        // Apply the accumulated impulse (warm start).
        const Px = c.pn * c.nx + c.pt * tx, Py = c.pn * c.ny + c.pt * ty;
        a.vx -= a.invMass * Px; a.vy -= a.invMass * Py;
        a.w -= a.invI * (r1x * Py - r1y * Px);
        b.vx += b.invMass * Px; b.vy += b.invMass * Py;
        b.w += b.invI * (r2x * Py - r2y * Px);
      }
    }

    // Sequential impulses.
    for (let it = 0; it < this.iterations; it++) {
      for (const arb of this.arbiters.values()) {
        const { a, b } = arb;
        for (const c of arb.contacts) {
          const r1x = c.px - a.x, r1y = c.py - a.y;
          const r2x = c.px - b.x, r2y = c.py - b.y;
          // Relative velocity at contact: vb + wb × r2 − va − wa × r1
          let dvx = b.vx - b.w * r2y - a.vx + a.w * r1y;
          let dvy = b.vy + b.w * r2x - a.vy - a.w * r1x;
          const vn = dvx * c.nx + dvy * c.ny;
          let dPn = c.massN * (-vn + c.bias);
          const pn0 = c.pn;
          c.pn = Math.max(pn0 + dPn, 0);
          dPn = c.pn - pn0;
          let Px = dPn * c.nx, Py = dPn * c.ny;
          a.vx -= a.invMass * Px; a.vy -= a.invMass * Py;
          a.w -= a.invI * (r1x * Py - r1y * Px);
          b.vx += b.invMass * Px; b.vy += b.invMass * Py;
          b.w += b.invI * (r2x * Py - r2y * Px);

          dvx = b.vx - b.w * r2y - a.vx + a.w * r1y;
          dvy = b.vy + b.w * r2x - a.vy - a.w * r1x;
          const tx = c.ny, ty = -c.nx;
          const vt = dvx * tx + dvy * ty;
          let dPt = c.massT * -vt;
          const maxPt = arb.friction * c.pn;
          const pt0 = c.pt;
          c.pt = Math.max(-maxPt, Math.min(pt0 + dPt, maxPt));
          dPt = c.pt - pt0;
          Px = dPt * tx; Py = dPt * ty;
          a.vx -= a.invMass * Px; a.vy -= a.invMass * Py;
          a.w -= a.invI * (r1x * Py - r1y * Px);
          b.vx += b.invMass * Px; b.vy += b.invMass * Py;
          b.w += b.invI * (r2x * Py - r2y * Px);
        }
      }
    }

    // Integrate velocities.
    for (const b of bs) {
      if (b.invMass === 0) continue;
      b.x += dt * b.vx;
      b.y += dt * b.vy;
      b.rot += dt * b.w;
    }
  }
}

// ---- Scene-level baking -------------------------------------------------------------

type Drop = {
  /** Frame (scene-local) at which the tile enters the world. */
  at: number;
  x: number;
  y: number;
  w: number;
  h: number;
  rot?: number;
  vy?: number;
  spin?: number;
};

type Wall = { x: number; y: number; w: number; h: number };

type SimSpec = {
  frames: number;
  fps: number;
  substeps: number;
  iterations: number;
  gravity: number;
  walls: Wall[];
  drops: Drop[];
};

/** Pose of each drop per frame; `null` before it enters. */
type Pose = { x: number; y: number; rot: number } | null;
type Baked = Pose[][];

/** Run the whole scene from frame 0 and record a pose per drop per frame. Pure. */
function simulate(spec: SimSpec): Baked {
  const world = new World(0, spec.gravity, spec.iterations);
  for (const w of spec.walls) world.add({ ...w, mass: 0, friction: 0.6 });
  const live: (Body | null)[] = spec.drops.map(() => null);
  const dt = 1 / (spec.fps * spec.substeps);
  const out: Baked = [];
  for (let f = 0; f < spec.frames; f++) {
    spec.drops.forEach((d, i) => {
      if (d.at === f) {
        live[i] = world.add({
          x: d.x, y: d.y, w: d.w, h: d.h, rot: d.rot ?? 0,
          vy: d.vy ?? 0, spin: d.spin ?? 0,
          mass: d.w * d.h, friction: 0.55,
        });
      }
    });
    out.push(live.map((b) => (b ? { x: b.x, y: b.y, rot: b.rot } : null)));
    for (let s = 0; s < spec.substeps; s++) world.step(dt);
  }
  return out;
}

const bakeCache = new Map<string, Baked>();

/** Memoized `simulate`: the first frame that asks pays for the whole scene once. */
function bake(spec: SimSpec): Baked {
  const key = JSON.stringify(spec);
  let baked = bakeCache.get(key);
  if (!baked) {
    baked = simulate(spec);
    bakeCache.set(key, baked);
  }
  return baked;
}

/** Deterministic PRNG (mulberry32) for authoring jitter — never Math.random. */
function seeded(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// The preview compiler rewrites `export const` without keeping a local binding,
// so exports are declared as locals and listed here.
export { bake, seeded, simulate };
export type { Drop, Pose, SimSpec, Wall };
