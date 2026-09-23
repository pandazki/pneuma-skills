// Scene 6 — Convergence + sign-off. Motion intent: subtle → static hold.
// The "human creativity / machine intelligence" painting pushes in, then gives way to the mark + wordmark.
import React from "react";
import { AbsoluteFill, Img, staticFile, useCurrentFrame } from "remotion";
import { C, F, Label, tw } from "./theme";
import { FONT, SIZE, T } from "./locale";

const FINALE_DUR = 270;

const SWAP = 110; // painting → sign-off
const REPO_URL = "github.com/pandazki/pneuma-skills";

const Finale: React.FC = () => {
  const f = useCurrentFrame();

  // Comes up fast over the settling pile (the handoff subject), before its caption.
  const paintIn = tw(f, 0, 16);
  // A true crossfade: the painting thins linearly while the mark comes up fast from the
  // midpoint, so the swap never passes through bare paper and the mark only overlaps the
  // painting's own lettering once that lettering is faint.
  const paintOut = tw(f, SWAP, SWAP + 28, 1, 0, (t) => t);
  const push = tw(f, 0, SWAP + 28, 1.0, 1.12, (t) => t);

  const markP = tw(f, SWAP + 12, SWAP + 40);
  const t = (a: number) => ({
    opacity: tw(f, a, a + 20),
    transform: `translateY(${tw(f, a, a + 24, 14, 0)}px)`,
  });

  return (
    <AbsoluteFill>
      {/* Painting */}
      <AbsoluteFill style={{ opacity: paintIn * paintOut, overflow: "hidden" }}>
        <Img
          src={staticFile("shift-convergence_1.jpg")}
          style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${push})`, transformOrigin: "50% 48%" }}
        />
        <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(242,234,220,0) 60%, rgba(242,234,220,0.92) 100%)" }} />
        <div style={{ position: "absolute", left: 80, bottom: 58, ...t(26) }}>
          <div style={{ fontFamily: F.head, fontWeight: FONT.headWeight, fontSize: 40, color: C.ink }}>{T.finale.caption}</div>
        </div>
      </AbsoluteFill>

      {/* Sign-off */}
      <div
        style={{
          position: "absolute",
          left: 150,
          top: 190,
          width: 320,
          height: 320,
          opacity: markP,
          transform: `scale(${0.92 + 0.08 * markP}) rotate(${(1 - markP) * -24}deg)`,
        }}
      >
        <Img
          src={staticFile("pneuma-mark.png")}
          style={{
            width: "100%",
            height: "100%",
            mixBlendMode: "multiply",
            WebkitMaskImage: "radial-gradient(circle, black 52%, transparent 70%)",
            maskImage: "radial-gradient(circle, black 52%, transparent 70%)",
          }}
        />
      </div>

      <div style={{ position: "absolute", left: 540, top: 214 }}>
        <Label color={C.terra} style={{ textTransform: "none", ...t(SWAP + 30) }}>
          πνεῦμα · breath
        </Label>
        <div style={{ marginTop: 14, fontFamily: F.display, fontWeight: 500, fontSize: 84, lineHeight: 1, color: C.ink, letterSpacing: -1.5, whiteSpace: "nowrap", ...t(SWAP + 34) }}>
          Pneuma Skills
        </div>
        <div style={{ marginTop: 20, fontFamily: F.body, fontSize: SIZE.finaleTagline, color: C.ink2, whiteSpace: "nowrap", ...t(SWAP + 44) }}>
          {T.finale.tagline}
        </div>
        <div style={{ marginTop: 34, display: "flex", gap: 0, alignItems: "center", ...t(SWAP + 56) }}>
          {T.finale.pillars.map((s, i) => (
            <React.Fragment key={s}>
              {i > 0 && <div style={{ width: 4, height: 4, borderRadius: 2, background: C.terra, margin: "0 14px" }} />}
              <span style={{ fontFamily: F.body, fontSize: 18, color: C.ink }}>{s}</span>
            </React.Fragment>
          ))}
        </div>
        {/* Quiet CTA */}
        <div style={{ marginTop: 40, display: "flex", alignItems: "center", gap: 14, ...t(SWAP + 70) }}>
          <div style={{ width: 28 * tw(f, SWAP + 72, SWAP + 96), height: 1.5, background: C.terra }} />
          <span style={{ fontFamily: F.mono, fontSize: 17, color: C.ink2, letterSpacing: 0.2 }}>{REPO_URL}</span>
        </div>
      </div>

      <Label style={{ position: "absolute", left: 80, right: 80, bottom: 46, textAlign: "right", letterSpacing: 1.2, textTransform: "none", ...t(SWAP + 90) }}>
        {T.finale.credit}
      </Label>
    </AbsoluteFill>
  );
};

// The preview compiler rewrites `export const` without keeping a local binding,
// so exports are declared as locals and listed here.
export { FINALE_DUR, Finale };
