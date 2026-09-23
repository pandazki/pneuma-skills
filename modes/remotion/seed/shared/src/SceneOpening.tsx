// Scene 1 — Etymology. Motion intent: subtle. Slow watercolor drift, the Greek word rises letter by letter.
import React from "react";
import { AbsoluteFill, Img, staticFile, useCurrentFrame } from "remotion";
import { C, F, Label, exitSubject, exitText, tw } from "./theme";
import { FONT, T } from "./locale";

const OPENING_DUR = 138;

const WORD = "πνεῦμα";

const Opening: React.FC = () => {
  const f = useCurrentFrame();
  // Frame 0 already shows the watercolor (it doubles as the poster frame). On the way out
  // the words leave first; the watercolor stays until the gap scene's panels are up.
  const textOut = exitText(f, OPENING_DUR);
  const imgOut = exitSubject(f, OPENING_DUR);

  const imgIn = tw(f, 0, 40, 0.3, 1);
  const imgScale = tw(f, 0, OPENING_DUR, 1.1, 1.0, (t) => t);
  const rule = tw(f, 30, 56);

  return (
    <AbsoluteFill>
      {/* Watercolor, right side, bleeding into paper */}
      <div
        style={{
          position: "absolute",
          right: -30,
          top: -60,
          width: 700,
          height: 870,
          opacity: imgIn * 0.95 * imgOut,
          transform: `scale(${imgScale}) translateY(${(1 - imgIn) * 20}px)`,
          transformOrigin: "60% 40%",
          WebkitMaskImage: "linear-gradient(90deg, transparent 0%, black 30%)",
          maskImage: "linear-gradient(90deg, transparent 0%, black 30%)",
        }}
      >
        <Img
          src={staticFile("etymology.jpg")}
          style={{ width: "100%", height: "100%", objectFit: "cover", mixBlendMode: "multiply" }}
        />
      </div>

      <div style={{ position: "absolute", left: 96, top: 170, opacity: textOut }}>
        <Label style={{ opacity: tw(f, 4, 20) }}>{T.opening.kicker}</Label>

        <div
          style={{
            marginTop: 18,
            display: "flex",
            fontFamily: F.greek,
            fontStyle: "italic",
            fontWeight: 400,
            fontSize: 150,
            lineHeight: 1,
            color: C.ink,
            letterSpacing: -1,
          }}
        >
          {WORD.split("").map((ch, i) => {
            const p = tw(f, 8 + i * 3, 36 + i * 3);
            return (
              <span key={i} style={{ display: "inline-block", overflow: "hidden", paddingBottom: 22, paddingRight: 4 }}>
                <span style={{ display: "inline-block", transform: `translateY(${(1 - p) * 110}%)`, opacity: p }}>
                  {ch}
                </span>
              </span>
            );
          })}
        </div>

        <div style={{ marginTop: 14, width: 132 * rule, height: 2, background: C.terra }} />

        <div
          style={{
            marginTop: 26,
            fontFamily: F.head,
            fontWeight: FONT.headWeight,
            fontSize: 30,
            lineHeight: 1.35,
            maxWidth: 520,
            color: C.ink2,
            opacity: tw(f, 38, 58),
            transform: `translateY(${tw(f, 38, 58, 12, 0)}px)`,
          }}
        >
          {T.opening.gloss}
        </div>

        <div
          style={{
            marginTop: 64,
            opacity: tw(f, 56, 78),
            transform: `translateY(${tw(f, 56, 78, 14, 0)}px)`,
          }}
        >
          <div style={{ fontFamily: F.display, fontSize: 40, fontWeight: 500, color: C.ink, letterSpacing: -0.5 }}>
            Pneuma Skills
          </div>
          <div style={{ marginTop: 8, fontFamily: F.body, fontSize: 22, color: C.ink2 }}>{T.opening.tagline}</div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

// The preview compiler rewrites `export const` without keeping a local binding,
// so exports are declared as locals and listed here.
export { OPENING_DUR, Opening };
