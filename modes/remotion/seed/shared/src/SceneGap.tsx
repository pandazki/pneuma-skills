// Scene 2 — The gap. Motion intent: animated. Agent tool calls stream on the left,
// an unreadable diff scrolls on the right. Two captions name each side, then one line names the gap.
import React from "react";
import { AbsoluteFill, random, useCurrentFrame } from "remotion";
import { C, F, Label, TEXT_IN, exitSubject, exitText, tw } from "./theme";
import { FONT, T } from "./locale";

const GAP_DUR = 240;

// The two cards sit exactly where the hero scene's file panel and viewer panel will
// appear, so the handoff reads as the same two windows, now connected.
const CARD_H = 330;
const CARD_Y = 150;
const LEFT_X = 80;
const LEFT_W = 470;
const RIGHT_X = 630;
const RIGHT_W = 570;

const CALLS: [string, string, string][] = [
  ["Read", "notes/kyoto-trip.md", ""],
  ["Write", "slides/kyoto.html", "+64"],
  ["Edit", "board/itinerary.json", "+12 −3"],
  ["Edit", "docs/budget.md", "+48 −9"],
  ["Write", "video/Intro.tsx", "+120"],
  ["Edit", "slides/theme.css", "+6 −6"],
  ["Bash", "ls slides/", ""],
];

const DIFF_LINES = Array.from({ length: 60 }, (_, i) => ({
  kind: random(`k${i}`) > 0.55 ? "+" : random(`m${i}`) > 0.4 ? "−" : " ",
  indent: Math.floor(random(`i${i}`) * 4),
  w: 80 + random(`w${i}`) * 300,
}));

const Card: React.FC<{ x: number; w: number; title: string; appear: number; dim: number; children: React.ReactNode }> = ({
  x,
  w,
  title,
  appear,
  dim,
  children,
}) => (
  <div
    style={{
      position: "absolute",
      left: x,
      top: CARD_Y,
      width: w,
      height: CARD_H,
      background: C.night,
      borderRadius: 14,
      overflow: "hidden",
      boxShadow: "0 30px 60px -30px rgba(60,35,20,0.55)",
      opacity: appear * (1 - dim * 0.55),
      transform: `translateY(${(1 - appear) * 16}px)`,
    }}
  >
    <div
      style={{
        height: 38,
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "0 16px",
        borderBottom: `1px solid ${C.nightLine}`,
      }}
    >
      {[C.terra, C.terraSoft, C.nightMuted].map((c) => (
        <div key={c} style={{ width: 9, height: 9, borderRadius: 5, background: c, opacity: 0.8 }} />
      ))}
      <div style={{ marginLeft: 10, fontFamily: F.mono, fontSize: 12, color: C.nightMuted }}>{title}</div>
    </div>
    {children}
  </div>
);

const Gap: React.FC = () => {
  const f = useCurrentFrame();
  const dim = tw(f, 142, 164);
  // Handoff: words leave first; the cards stay until the hero panels cover them.
  const textOut = exitText(f, GAP_DUR);
  const cardsOut = exitSubject(f, GAP_DUR);

  return (
    <AbsoluteFill>
      <Label style={{ position: "absolute", left: LEFT_X, top: 88, opacity: tw(f, TEXT_IN, TEXT_IN + 14) * textOut }}>
        {T.gap.kicker}
      </Label>

      {/* Agent side — tool calls */}
      <Card x={LEFT_X} w={LEFT_W} title="claude-code · session" appear={tw(f, 0, 16) * cardsOut} dim={dim}>
        <div style={{ padding: "18px 22px", fontFamily: F.mono, fontSize: 15, lineHeight: "33px" }}>
          {CALLS.map(([tool, path, delta], i) => {
            const t0 = 22 + i * 11;
            const p = tw(f, t0, t0 + 10);
            const chars = Math.floor(tw(f, t0, t0 + 14, 0, path.length, (t) => t));
            return (
              <div key={i} style={{ display: "flex", opacity: p, transform: `translateX(${(1 - p) * -10}px)` }}>
                <span style={{ width: 64, color: tool === "Read" || tool === "Bash" ? C.sageSoft : C.terraSoft }}>
                  {tool}
                </span>
                <span style={{ color: C.nightText, flex: 1 }}>{path.slice(0, chars)}</span>
                <span style={{ color: C.nightMuted }}>{chars >= path.length ? delta : ""}</span>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Human side — an endless diff */}
      <Card x={RIGHT_X} w={RIGHT_W} title="git diff --stat · 1,284 lines" appear={tw(f, 4, 20) * cardsOut} dim={dim}>
        <div style={{ position: "absolute", top: 38, left: 0, right: 0, bottom: 0, overflow: "hidden" }}>
          <div style={{ transform: `translateY(${-Math.max(0, f - 26) * 2.4}px)`, padding: "14px 22px" }}>
            {DIFF_LINES.map((l, i) => (
              <div key={i} style={{ height: 17, display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 10, fontFamily: F.mono, fontSize: 12, color: l.kind === "+" ? C.sage : C.terraSoft }}>
                  {l.kind}
                </span>
                <div
                  style={{
                    marginLeft: l.indent * 16,
                    width: l.w,
                    height: 6,
                    borderRadius: 3,
                    background:
                      l.kind === "+" ? "rgba(123,154,128,0.55)" : l.kind === "−" ? "rgba(217,137,106,0.5)" : "rgba(233,223,205,0.18)",
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* Captions under each card */}
      {[
        { x: LEFT_X, t: 60, text: T.gap.agentCaption },
        { x: RIGHT_X, t: 86, text: T.gap.humanCaption },
      ].map((c) => (
        <div
          key={c.text}
          style={{
            position: "absolute",
            left: c.x,
            top: CARD_Y + CARD_H + 30,
            fontFamily: F.head,
            fontWeight: FONT.headWeight,
            fontSize: 30,
            color: C.ink,
            opacity: tw(f, c.t, c.t + 20) * (1 - dim * 0.6) * textOut,
            transform: `translateY(${tw(f, c.t, c.t + 20, 14, 0)}px)`,
          }}
        >
          {c.text}
        </div>
      ))}

      {/* The gap line */}
      <div
        style={{
          position: "absolute",
          left: LEFT_X,
          top: 600,
          display: "flex",
          alignItems: "center",
          gap: 22,
          opacity: tw(f, 150, 172) * textOut,
          transform: `translateY(${tw(f, 150, 172, 16, 0)}px)`,
        }}
      >
        <div style={{ width: 48 * tw(f, 154, 182), height: 2, background: C.terra }} />
        <div style={{ fontFamily: F.head, fontWeight: FONT.headWeight, fontSize: 40, color: C.ink }}>
          {T.gap.missingPre}
          <span style={{ color: C.terra }}>{T.gap.missingEm}</span>
          {T.gap.missingPost}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// The preview compiler rewrites `export const` without keeping a local binding,
// so exports are declared as locals and listed here.
export { GAP_DUR, Gap };
