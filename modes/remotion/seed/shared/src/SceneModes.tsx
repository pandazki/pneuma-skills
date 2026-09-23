// Scene 5 — The catalog. Motion intent: physical. Right after "Distribution", the real mode
// catalog rains in as packaged tiles and piles up on a shelf; a counter tallies them; the
// last tile to land is an empty, dashed one — the mode you could make next.
//
// The pile is a rigid-body simulation (physics.ts), baked once from frame 0 and memoized,
// so any frame renders the same pixels on its own — in the Player, in `remotion render`,
// and in an isolated `remotion still`.
import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { C, F, Label, TEXT_IN, exitSubject, exitText, tw } from "./theme";
import { FONT, T } from "./locale";
import { bake, seeded } from "./physics";
import type { Drop, SimSpec } from "./physics";

const MODES_DUR = 240;

const PX = 100; // pixels per world unit
const FLOOR_Y = 648; // top of the shelf, px
const SHELF_L = 80;
const SHELF_R = 1200;
// The heading and the counter own the band above BAND_Y. Tiles are born inside it (hidden)
// and only become visible as they fall through a soft edge below it, so no tile ever
// crosses a word — during the drop or in the settled pile.
const BAND_Y = 222;
const BAND_FADE = 60;
const SPAWN_Y = 2.0; // world units (px / 100): inside the hidden band

type Tile = { id: string; w: number; h: number; lane: number; kind?: "here" | "yours" };

// Drop order = stacking order. Sizes are fixed so the simulation is the same in every language.
const TILES: Tile[] = [
  { id: "slide", w: 172, h: 62, lane: 2.1 },
  { id: "webcraft", w: 188, h: 62, lane: 9.7 },
  { id: "doc", w: 156, h: 66, lane: 5.6 },
  { id: "diagram", w: 172, h: 62, lane: 11.0 },
  { id: "kami", w: 156, h: 62, lane: 3.6 },
  { id: "gridboard", w: 188, h: 66, lane: 7.7 },
  { id: "draw", w: 156, h: 62, lane: 1.8 },
  { id: "clipcraft", w: 172, h: 62, lane: 10.3 },
  { id: "illustrate", w: 188, h: 62, lane: 6.3 },
  { id: "bansho", w: 156, h: 66, lane: 4.3 },
  { id: "backlot", w: 172, h: 62, lane: 8.8 },
  { id: "eli5", w: 156, h: 62, lane: 2.6 },
  { id: "plotwise", w: 172, h: 66, lane: 10.6 },
  { id: "cosmos", w: 156, h: 62, lane: 5.1 },
  { id: "sprite", w: 156, h: 62, lane: 7.3 },
  { id: "lucid", w: 156, h: 62, lane: 3.2 },
  { id: "remotion", w: 188, h: 66, lane: 6.0, kind: "here" },
  { id: "wordtaste", w: 172, h: 62, lane: 9.6 },
  { id: "mode-maker", w: 188, h: 62, lane: 1.9 },
  { id: "your-mode", w: 188, h: 66, lane: 7.0, kind: "yours" },
];

const CATALOG = TILES.filter((t) => t.kind !== "yours").length;
const DROP_T0 = 4;
const DROP_STEP = 5;
const YOURS_AT = 134;

// Seed picked by baking candidates offline and keeping a pile where every tile rests
// legibly and the last two (this video, yours) land flat on top.
const jitter = seeded(74);
const DROPS: Drop[] = TILES.map((t, i) => {
  const half = t.w / 2 / PX;
  const minX = SHELF_L / PX + half + 0.02;
  const maxX = SHELF_R / PX - half - 0.02;
  const x = Math.min(maxX, Math.max(minX, t.lane + (jitter() - 0.5) * 0.5));
  return {
    at: t.kind === "yours" ? YOURS_AT : DROP_T0 + i * DROP_STEP,
    x,
    y: SPAWN_Y - jitter() * 0.3,
    w: t.w / PX,
    h: t.h / PX,
    rot: (jitter() - 0.5) * 0.3,
    vy: 3.5,
    spin: (jitter() - 0.5) * 0.9,
  };
});

const SPEC: SimSpec = {
  frames: MODES_DUR,
  fps: 30,
  substeps: 2,
  iterations: 12,
  gravity: 18,
  walls: [
    { x: 6.4, y: FLOOR_Y / PX + 0.2, w: 14, h: 0.4 }, // shelf
    { x: SHELF_L / PX - 0.2, y: 0, w: 0.4, h: 14 }, // left
    { x: SHELF_R / PX + 0.2, y: 0, w: 0.4, h: 14 }, // right
  ],
  drops: DROPS,
};

/** First frame each tile hits something (its fall speed drops sharply). Derived from the bake. */
let landingCache: number[] | null = null;
const landingFrames = (): number[] => {
  if (landingCache) return landingCache;
  const baked = bake(SPEC);
  landingCache = DROPS.map((d, i) => {
    for (let f = d.at + 2; f < baked.length; f++) {
      const a = baked[f - 2][i], b = baked[f - 1][i], c = baked[f][i];
      if (!a || !b || !c) continue;
      if (c.y - b.y < 0.5 * (b.y - a.y)) return f;
    }
    return baked.length;
  });
  return landingCache;
};

const Tile: React.FC<{ t: Tile; x: number; y: number; rot: number; glow: number }> = ({ t, x, y, rot, glow }) => {
  const here = t.kind === "here";
  const yours = t.kind === "yours";
  const accent = [C.terra, C.sage, C.ink2, C.terraSoft][TILES.indexOf(t) % 4];
  const label = yours
    ? T.modes.yourTile
    : here
      ? `${T.modes.labels[t.id]} · ${T.modes.here}`
      : T.modes.labels[t.id];
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: t.w,
        height: t.h,
        boxSizing: "border-box",
        transform: `translate(${x * PX - t.w / 2}px, ${y * PX - t.h / 2}px) rotate(${rot}rad)`,
        borderRadius: 8,
        padding: "0 16px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 5,
        background: here ? C.terra : yours ? "rgba(250,245,235,0.92)" : C.card,
        border: yours ? `1.5px dashed ${C.terra}` : `1px solid ${here ? C.terra : C.line}`,
        boxShadow: yours
          ? `0 0 0 ${6 * glow}px rgba(186,83,52,${0.16 * glow}), 0 12px 22px -14px rgba(60,35,20,0.5)`
          : "0 12px 22px -14px rgba(60,35,20,0.5)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        {!yours && (
          <div style={{ width: 9, height: 9, borderRadius: 2, background: here ? C.paper : accent, flexShrink: 0 }} />
        )}
        <span style={{ fontFamily: F.mono, fontSize: 15, fontWeight: 500, color: here ? C.paper : yours ? C.terra : C.ink, whiteSpace: "nowrap" }}>
          {yours ? "+ your-mode" : t.id}
        </span>
      </div>
      <div
        style={{
          fontFamily: F.body,
          fontSize: 13.5,
          color: here ? "rgba(250,245,235,0.82)" : C.muted,
          whiteSpace: "nowrap",
          paddingLeft: yours ? 0 : 18,
        }}
      >
        {label}
      </div>
    </div>
  );
};

const Modes: React.FC = () => {
  const f = useCurrentFrame();
  // Handoff: heading leaves first; the pile stays until the finale painting is up.
  const textOut = exitText(f, MODES_DUR);
  const subjOut = exitSubject(f, MODES_DUR);
  const poses = bake(SPEC)[Math.min(f, MODES_DUR - 1)];
  const landed = landingFrames();
  const yoursIndex = TILES.length - 1;
  const count = landed.slice(0, CATALOG).filter((lf) => lf <= f).length;
  const lastLand = Math.max(0, ...landed.slice(0, CATALOG).filter((lf) => lf <= f));
  const bump = count > 0 ? tw(f, lastLand, lastLand + 8, 1, 0) : 0;
  const yoursLanded = landed[yoursIndex];
  const glow = tw(f, yoursLanded, yoursLanded + 16) * (0.6 + 0.4 * Math.cos((f - yoursLanded) / 6));

  return (
    <AbsoluteFill>
      {/* Tiles — masked out above the protected heading band. */}
      <AbsoluteFill
        style={{
          opacity: subjOut,
          WebkitMaskImage: `linear-gradient(to bottom, transparent ${BAND_Y}px, black ${BAND_Y + BAND_FADE}px)`,
          maskImage: `linear-gradient(to bottom, transparent ${BAND_Y}px, black ${BAND_Y + BAND_FADE}px)`,
        }}
      >
        {TILES.map((t, i) => {
          const p = poses[i];
          if (!p) return null;
          return <Tile key={t.id} t={t} x={p.x} y={p.y} rot={p.rot} glow={i === yoursIndex ? glow : 0} />;
        })}
      </AbsoluteFill>

      {/* Shelf */}
      <div
        style={{
          position: "absolute",
          left: SHELF_L,
          top: FLOOR_Y,
          width: (SHELF_R - SHELF_L) * tw(f, 0, 30),
          height: 1.5,
          background: C.ink2,
          opacity: 0.55 * subjOut,
        }}
      />
      <Label style={{ position: "absolute", left: SHELF_L, top: FLOOR_Y + 16, letterSpacing: 1.6, textTransform: "none", opacity: tw(f, 20, 36) * subjOut }}>
        modes/ · catalog
      </Label>
      {/* Heading — inside the protected band */}
      <div style={{ position: "absolute", left: 80, top: 70, opacity: textOut }}>
        <Label color={C.terra} style={{ opacity: tw(f, TEXT_IN, TEXT_IN + 14) }}>
          {T.modes.kicker}
        </Label>
        <div
          style={{
            marginTop: 12,
            fontFamily: F.head,
            fontWeight: FONT.headWeight,
            fontSize: 40,
            color: C.ink,
            opacity: tw(f, TEXT_IN + 4, TEXT_IN + 24),
            transform: `translateY(${tw(f, TEXT_IN + 4, TEXT_IN + 26, 14, 0)}px)`,
          }}
        >
          {T.modes.headline}
        </div>
        <div style={{ position: "relative", marginTop: 14, height: 34 }}>
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              whiteSpace: "nowrap",
              fontFamily: F.body,
              fontSize: 22,
              color: C.ink2,
              opacity: tw(f, TEXT_IN + 14, TEXT_IN + 32) * tw(f, yoursLanded + 2, yoursLanded + 12, 1, 0),
              transform: `translateY(${tw(f, TEXT_IN + 14, TEXT_IN + 36, 10, 0) - tw(f, yoursLanded + 2, yoursLanded + 12, 0, 8)}px)`,
            }}
          >
            {T.modes.sub}
          </div>
          <div
          style={{
            position: "absolute",
            left: 0,
            top: -2,
            whiteSpace: "nowrap",
            fontFamily: F.head,
            fontWeight: FONT.headWeight,
            fontSize: 26,
            color: C.terra,
            opacity: tw(f, yoursLanded + 10, yoursLanded + 26),
            transform: `translateY(${tw(f, yoursLanded + 10, yoursLanded + 28, 10, 0)}px)`,
          }}
        >
          {T.modes.yours}
          </div>
        </div>
      </div>

      {/* Counter */}
      <div style={{ position: "absolute", right: 80, top: 62, textAlign: "right", opacity: tw(f, TEXT_IN + 2, TEXT_IN + 18) * textOut }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "flex-end", gap: 10 }}>
          <span
            style={{
              fontFamily: F.display,
              fontStyle: "italic",
              fontWeight: 300,
              fontSize: 76,
              lineHeight: 1,
              color: C.ink,
              fontVariantNumeric: "tabular-nums",
              display: "inline-block",
              transform: `translateY(${-4 * bump}px)`,
            }}
          >
            {String(count).padStart(2, "0")}
          </span>
          <span
            style={{
              fontFamily: F.display,
              fontStyle: "italic",
              fontSize: 34,
              color: C.terra,
              opacity: tw(f, yoursLanded, yoursLanded + 12),
            }}
          >
            +1
          </span>
        </div>
        <Label style={{ marginTop: 6 }}>{T.modes.counter}</Label>
      </div>

    </AbsoluteFill>
  );
};

// The preview compiler rewrites `export const` without keeping a local binding,
// so exports are declared as locals and listed here.
// SPEC is exported so tools (and tests) can bake the exact pile this scene draws.
export { MODES_DUR, Modes, SPEC, TILES };
