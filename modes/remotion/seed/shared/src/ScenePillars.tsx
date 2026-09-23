// Scene 4 — Four pillars. Motion intent: animated (each pillar carries a small vector diagram
// that shows the idea; the illustration sets the mood). Image side alternates for rhythm.
import React from "react";
import { AbsoluteFill, Img, Sequence, staticFile, useCurrentFrame } from "remotion";
import { C, F, HANDOFF, Label, TEXT_IN, exitSubject, exitText, expoInOut, tw } from "./theme";
import { FONT, SIZE, T } from "./locale";

// Each pillar starts HANDOFF frames before the previous one ends. The images alternate
// sides, so the handoff runs: old words leave → new image wipes in where they were →
// old image leaves → new words arrive where it was. The frame always has a picture.
const PILLAR_STEP = 164;
const PILLAR_DUR = PILLAR_STEP + HANDOFF;
const PILLARS_DUR = PILLAR_STEP * 3 + PILLAR_DUR;
/** Pillar text (and its diagram) starts this late, after the previous subject has gone. */
const TEXT_T0 = TEXT_IN + 2;

const IMG_W = 600;
const IMG_H = 450;
const IMG_Y = 140;
const TEXT_W = 480;
const DIAG_H = 150;

// ---- Diagrams (each draws inside a TEXT_W × DIAG_H box) -------------------

const ViewerDiagram: React.FC<{ f: number }> = ({ f }) => {
  const modes = T.pillars.viewerKinds;
  const on = f < 60 ? -1 : Math.floor((f - 60) / 14) % modes.length;
  return (
    <div style={{ position: "relative", height: DIAG_H }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div
          style={{
            fontFamily: F.mono,
            fontSize: 13,
            color: C.ink2,
            padding: "8px 12px",
            border: `1px solid ${C.line}`,
            borderRadius: 6,
            opacity: tw(f, 40, 54),
          }}
        >
          files
        </div>
        <div style={{ width: 44 * tw(f, 46, 62), height: 1.5, background: C.terra, position: "relative" }}>
          <div
            style={{
              position: "absolute",
              right: -1,
              top: -4,
              width: 0,
              height: 0,
              borderTop: "4.75px solid transparent",
              borderBottom: "4.75px solid transparent",
              borderLeft: `8px solid ${C.terra}`,
              opacity: tw(f, 58, 62),
            }}
          />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {modes.map((m, i) => (
            <div
              key={m}
              style={{
                fontFamily: F.body,
                fontSize: 16,
                padding: "7px 11px",
                borderRadius: 6,
                background: on === i ? C.terra : "transparent",
                color: on === i ? C.paper : C.ink,
                border: `1px solid ${on === i ? C.terra : C.line}`,
                opacity: tw(f, 50 + i * 4, 64 + i * 4),
              }}
            >
              {m}
            </div>
          ))}
        </div>
      </div>
      <div style={{ marginTop: 16, fontFamily: F.mono, fontSize: 12, color: C.muted, opacity: tw(f, 70, 86) }}>
        {T.pillars.viewerNote}
      </div>
    </div>
  );
};

const SkillsDiagram: React.FC<{ f: number }> = ({ f }) => {
  const rows: [number, string, string][] = [
    [0, ".claude/skills/", ""],
    [1, "pneuma-slide/", ""],
    [2, "SKILL.md", T.pillars.skillNotes[0]],
    [2, "references/", T.pillars.skillNotes[1]],
    [2, "rules/", T.pillars.skillNotes[2]],
  ];
  return (
    <div style={{ height: DIAG_H, fontFamily: F.mono, fontSize: 14, lineHeight: "27px" }}>
      {rows.map(([depth, name, note], i) => {
        const p = tw(f, 40 + i * 6, 56 + i * 6);
        return (
          <div key={i} style={{ display: "flex", opacity: p, transform: `translateX(${(1 - p) * -8}px)` }}>
            <span style={{ width: depth * 22 }} />
            {depth > 0 && <span style={{ color: C.muted, marginRight: 8 }}>└</span>}
            <span style={{ color: name.endsWith(".md") ? C.terra : C.ink, width: 190 - depth * 22 }}>{name}</span>
            <span style={{ fontFamily: F.body, fontSize: 14, color: C.muted, opacity: tw(f, 64 + i * 6, 78 + i * 6) }}>{note}</span>
          </div>
        );
      })}
    </div>
  );
};

const LearningDiagram: React.FC<{ f: number }> = ({ f }) => {
  // Four sessions on a line; each drops one line into the preferences file.
  const N = 4;
  const GAP = 84;
  const X0 = 10;
  const DOT = 12;
  const lineW = GAP * (N - 1);
  const drawn = tw(f, 40, 96, 0, 1, (t) => t);
  return (
    <div style={{ position: "relative", height: DIAG_H }}>
      <div style={{ position: "absolute", left: X0 + DOT / 2, top: 22 + DOT / 2 - 0.75, width: lineW * drawn, height: 1.5, background: C.line }} />
      {Array.from({ length: N }).map((_, i) => {
        const t = 40 + i * 18;
        const lit = tw(f, t, t + 10);
        return (
          <div key={i}>
            <div
              style={{
                position: "absolute",
                left: X0 + i * GAP,
                top: 22,
                width: DOT,
                height: DOT,
                borderRadius: DOT / 2,
                background: lit > 0.5 ? C.terra : C.paper,
                border: `1.5px solid ${lit > 0 ? C.terra : C.line}`,
                boxSizing: "border-box",
              }}
            />
            <div style={{ position: "absolute", left: X0 + i * GAP - 14, top: 0, width: 40, textAlign: "center", fontFamily: F.mono, fontSize: 10.5, color: C.muted, opacity: lit }}>
              #{i + 1}
            </div>
          </div>
        );
      })}
      <div
        style={{
          position: "absolute",
          left: X0 + lineW + 40,
          top: 4,
          width: 150,
          padding: "8px 10px 6px",
          border: `1px solid ${C.line}`,
          borderRadius: 6,
          background: "rgba(250,245,235,0.8)",
          opacity: tw(f, 36, 50),
        }}
      >
        <div style={{ fontFamily: F.mono, fontSize: 11, color: C.ink2, marginBottom: 6 }}>preferences.md</div>
        {Array.from({ length: N }).map((_, i) => {
          const t = 48 + i * 18;
          return <div key={i} style={{ height: 4, marginBottom: 5, borderRadius: 2, width: `${[82, 64, 90, 55][i] * tw(f, t, t + 14)}%`, background: i === N - 1 ? C.terra : C.sageSoft }} />;
        })}
      </div>
      <div style={{ position: "absolute", left: 0, top: 70, fontFamily: F.body, fontSize: 16, color: C.ink2, opacity: tw(f, 100, 116) }}>
        {T.pillars.learningNote}
      </div>
    </div>
  );
};

const DistributionDiagram: React.FC<{ f: number }> = ({ f }) => {
  // One source mode fans out to three workspaces. All in one SVG coordinate system so lines meet the nodes.
  const src = { x: 40, y: 60 };
  const dsts = [
    { x: 300, y: 16, label: T.pillars.destinations[0] },
    { x: 300, y: 60, label: T.pillars.destinations[1] },
    { x: 300, y: 104, label: T.pillars.destinations[2] },
  ];
  return (
    <div style={{ position: "relative", height: DIAG_H }}>
      <svg width={TEXT_W} height={130} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
        {dsts.map((d, i) => {
          const p = tw(f, 52 + i * 8, 82 + i * 8, 0, 1, expoInOut);
          const x1 = src.x + 50;
          const x2 = d.x - 8;
          const path = `M ${x1} ${src.y} C ${x1 + 90} ${src.y}, ${x2 - 90} ${d.y}, ${x2} ${d.y}`;
          return <path key={i} d={path} fill="none" stroke={C.terra} strokeWidth={1.5} pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - p} />;
        })}
        {dsts.map((d, i) => (
          <circle key={i} cx={d.x - 4} cy={d.y} r={4} fill={C.terra} opacity={tw(f, 76 + i * 8, 86 + i * 8)} />
        ))}
      </svg>
      <div
        style={{
          position: "absolute",
          left: src.x - 40,
          top: src.y - 16,
          width: 90,
          height: 32,
          border: `1.5px solid ${C.terra}`,
          borderRadius: 6,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: F.mono,
          fontSize: 13,
          color: C.terra,
          opacity: tw(f, 40, 54),
        }}
      >
        mode
      </div>
      {dsts.map((d, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: d.x + 8,
            top: d.y - 12,
            height: 24,
            display: "flex",
            alignItems: "center",
            fontFamily: F.body,
            fontSize: 16,
            color: C.ink,
            whiteSpace: "nowrap",
            opacity: tw(f, 80 + i * 8, 94 + i * 8),
          }}
        >
          {d.label}
        </div>
      ))}
    </div>
  );
};

// ---- Pillar layout --------------------------------------------------------

type PillarDef = {
  n: string;
  img: string;
  pos?: string;
  /** contain + backdrop for wide art that shouldn't be cropped */
  fit?: { bg: string };
  /** [from, to] scale and transform-origin — used to crop baked-in text out of frame */
  zoom?: [number, number];
  origin?: string;
  /** Width / height of the art; with `fit`, labels are placed in the art's own coordinates. */
  aspect?: number;
  Labels?: React.FC;
  Diagram: React.FC<{ f: number }>;
};

// The visual-environment painting had garbled lettering baked into two chat bubbles and the
// video thumbnail. Those areas are painted out in the asset; the readable words are set here
// as real text, positioned in percent of the painting so they follow its zoom.
const VisualEnvLabels: React.FC = () => {
  const [first, second] = T.pillars.visualChat;
  const bubble: React.CSSProperties = {
    position: "absolute",
    left: "55.2%",
    fontFamily: F.body,
    fontSize: 12.5,
    lineHeight: "17px",
    color: C.ink,
    whiteSpace: "pre-line",
  };
  return (
    <>
      <div style={{ ...bubble, top: "26.6%" }}>{first}</div>
      <div style={{ ...bubble, top: "77.9%" }}>{second}</div>
      <div
        style={{
          position: "absolute",
          left: "24.4%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          fontFamily: F.greek,
          fontStyle: "italic",
          fontSize: 26,
          color: "#f6efe2",
          textShadow: "0 1px 6px rgba(20,12,8,0.45)",
        }}
      >
        πνεῦμα
      </div>
    </>
  );
};

const PILLARS: PillarDef[] = [
  { n: "01", img: "pillar-visual-env_2.jpg", fit: { bg: "#382d2c" }, aspect: 1376 / 768, zoom: [1.08, 1.03], Labels: VisualEnvLabels, Diagram: ViewerDiagram },
  { n: "02", img: "pillar-skills_1.jpg", Diagram: SkillsDiagram },
  { n: "03", img: "pillar-learning.jpg", zoom: [1.5, 1.4], origin: "25% 15%", Diagram: LearningDiagram },
  { n: "04", img: "pillar-distribution_1.jpg", pos: "40% 50%", Diagram: DistributionDiagram },
];

const Pillar: React.FC<{ p: PillarDef; index: number }> = ({ p, index }) => {
  const f = useCurrentFrame();
  const copy = T.pillars.items[index];
  const imgLeft = index % 2 === 1;
  const imgX = imgLeft ? 80 : 1280 - 80 - IMG_W;
  const textX = imgLeft ? 80 + IMG_W + 60 : 80;

  // Fast-starting wipe: the new picture is readable within a few frames of the handoff.
  const reveal = tw(f, 0, 30);
  const textOut = exitText(f, PILLAR_DUR);
  const imgOut = exitSubject(f, PILLAR_DUR);
  const clip = imgLeft ? `inset(0 ${(1 - reveal) * 100}% 0 0 round 10px)` : `inset(0 0 0 ${(1 - reveal) * 100}% round 10px)`;
  const [z0, z1] = p.zoom ?? [1.12, 1.0];
  const zoom = tw(f, 0, PILLAR_DUR, z0, z1, (t) => t);

  const t = (a: number) => ({
    opacity: tw(f, a, a + 18) * textOut,
    transform: `translateY(${tw(f, a, a + 22, 18, 0) - (1 - textOut) * 10}px)`,
  });
  const artH = p.aspect ? IMG_W / p.aspect : IMG_H;

  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", left: imgX, top: IMG_Y, width: IMG_W, height: IMG_H, clipPath: clip, opacity: imgOut, background: p.fit?.bg, overflow: "hidden" }}>
        {/* The art (plus any labels) scales as one piece. */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: (IMG_H - artH) / 2,
            width: IMG_W,
            height: artH,
            transform: `scale(${zoom})`,
            transformOrigin: p.origin ?? "50% 50%",
          }}
        >
          <Img
            src={staticFile(p.img)}
            style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: p.pos ?? "50% 50%" }}
          />
          {p.Labels && <p.Labels />}
        </div>
      </div>

      <div style={{ position: "absolute", left: textX, top: IMG_Y + 6, width: TEXT_W }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, ...t(TEXT_T0) }}>
          <span style={{ fontFamily: F.display, fontStyle: "italic", fontSize: 34, color: C.terra }}>{p.n}</span>
          <Label>{copy.kicker}</Label>
        </div>
        <div style={{ marginTop: 10, fontFamily: F.head, fontWeight: FONT.titleWeight, fontSize: SIZE.pillarTitle, lineHeight: 1.08, color: C.ink, letterSpacing: SIZE.pillarTitleTracking, ...t(TEXT_T0 + 6) }}>{copy.title}</div>
        {/* Bodies carry deliberate line breaks (\n) so short paragraphs never leave an orphan. */}
        <div style={{ marginTop: 18, fontFamily: F.body, fontSize: 22, lineHeight: 1.6, color: C.ink2, maxWidth: 460, whiteSpace: "pre-line", ...t(TEXT_T0 + 14) }}>
          {copy.body}
        </div>
        <div style={{ marginTop: 34, width: TEXT_W, height: 1, background: C.line, ...t(TEXT_T0 + 22) }} />
        <div style={{ marginTop: 22, opacity: textOut }}>
          <p.Diagram f={f - (TEXT_T0 - 8)} />
        </div>
      </div>
    </AbsoluteFill>
  );
};

const Pillars: React.FC = () => {
  const f = useCurrentFrame();
  const active = Math.min(3, Math.floor(f / PILLAR_STEP));
  const within = Math.min(1, (f - active * PILLAR_STEP) / (active === 3 ? PILLAR_DUR : PILLAR_STEP));
  const railIn = tw(f, TEXT_IN, TEXT_IN + 16) * exitText(f, PILLARS_DUR);

  return (
    <AbsoluteFill>
      {/* Rail */}
      <div style={{ position: "absolute", left: 80, right: 80, top: 70, display: "flex", alignItems: "center", opacity: railIn }}>
        <Label color={C.ink2}>{T.pillars.rail}</Label>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", gap: 18 }}>
          {PILLARS.map((p, i) => (
            <div key={p.n} style={{ width: 86 }}>
              <div style={{ fontFamily: F.mono, fontSize: 12, color: i === active ? C.terra : C.muted, marginBottom: 7 }}>
                {p.n} <span style={{ fontFamily: F.body, fontSize: 13 }}>{T.pillars.items[i].rail}</span>
              </div>
              <div style={{ height: 2, background: C.line, position: "relative" }}>
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: `${(i < active ? 1 : i === active ? within : 0) * 100}%`,
                    background: C.terra,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {PILLARS.map((p, i) => (
        <Sequence key={p.n} from={i * PILLAR_STEP} durationInFrames={PILLAR_DUR} layout="none">
          <Pillar p={p} index={i} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

// The preview compiler rewrites `export const` without keeping a local binding,
// so exports are declared as locals and listed here.
export { PILLAR_DUR, PILLARS_DUR, Pillars };
