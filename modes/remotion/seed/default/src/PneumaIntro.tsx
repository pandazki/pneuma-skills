// Aesthetic: Editorial typographic — warm paper, serif display, asymmetric layouts
// Direction: "A magazine spread that moves." Rich illustrations + kinetic typography.

import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  Easing,
  Sequence,
  spring,
  Img,
  staticFile,
} from "remotion";

// ─── Fonts ───────────────────────────────────────────────
const fontCSS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,500;0,9..144,700;1,9..144,300;1,9..144,400&family=DM+Sans:ital,wght@0,300;0,400;0,500;1,300&display=swap');
`;

// ─── Palette ─────────────────────────────────────────────
const C = {
  bg: "#f4efe8",
  text: "#2d2621",
  accent: "#b85c3a",
  muted: "#8a7e75",
  faint: "#d4c9bd",
  bgDark: "#2d2621",
  textLight: "#f4efe8",
  accentLight: "#e8a87c",
};

const FONT_DISPLAY = "'Fraunces', 'Georgia', serif";
const FONT_BODY = "'DM Sans', 'Helvetica Neue', sans-serif";

// ─── Animation helpers ──────────────────────────────────
const expoOut = Easing.out(Easing.exp);

function springIn(
  frame: number,
  fps: number,
  delay: number = 0,
  config?: { damping?: number; stiffness?: number; mass?: number }
) {
  return spring({
    frame,
    fps,
    delay: delay * fps,
    config: { damping: 200, ...config },
  });
}

function fadeSlideUp(
  frame: number,
  fps: number,
  opts?: { delay?: number; duration?: number; distance?: number }
) {
  const delay = opts?.delay ?? 0;
  const duration = opts?.duration ?? 0.6;
  const distance = opts?.distance ?? 40;
  const f = frame - delay * fps;
  const d = duration * fps;
  const opacity = interpolate(f, [0, d], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: expoOut,
  });
  const y = interpolate(f, [0, d], [distance, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: expoOut,
  });
  return { opacity, y };
}

function sceneExit(
  frame: number,
  fps: number,
  sceneDur: number,
  fadeDur: number = 0.4
) {
  return interpolate(
    frame,
    [(sceneDur - fadeDur) * fps, sceneDur * fps],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
}

// ═══════════════════════════════════════════════════════════
// Scene 1: Cold Open — cursor types, world opens
// ═══════════════════════════════════════════════════════════
const SceneColdOpen: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const prompt = "create something together";
  const charsVisible = Math.floor(
    interpolate(frame, [0.3 * fps, 1.6 * fps], [0, prompt.length], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })
  );

  const cursorBlink =
    frame < 0.3 * fps || charsVisible >= prompt.length
      ? Math.round(Math.sin(frame * 0.25) * 0.5 + 0.5)
      : 1;

  // Terminal fades quickly, title rises
  const termFade = interpolate(frame, [1.8 * fps, 2.2 * fps], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const titleSpring = springIn(frame, fps, 2.0);
  const titleY = interpolate(titleSpring, [0, 1], [50, 0]);

  const subSpring = springIn(frame, fps, 2.4);
  const subY = interpolate(subSpring, [0, 1], [30, 0]);

  // Decorative line grows from center
  const lineW = interpolate(frame, [2.6 * fps, 3.3 * fps], [0, 120], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: expoOut,
  });

  const exit = sceneExit(frame, fps, 5.5);

  return (
    <AbsoluteFill style={{ backgroundColor: C.bg, opacity: exit }}>
      {/* Subtle decorative circle */}
      <div
        style={{
          position: "absolute",
          width: 500,
          height: 500,
          borderRadius: "50%",
          border: `1px solid ${C.faint}`,
          top: "50%",
          left: "50%",
          transform: `translate(-50%, -50%) scale(${interpolate(frame, [2.0 * fps, 3.5 * fps], [0.3, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: expoOut })})`,
          opacity: interpolate(frame, [2.0 * fps, 3.0 * fps], [0, 0.3], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      />

      {/* Terminal prompt */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          opacity: termFade,
          fontFamily: FONT_BODY,
          fontSize: 28,
          color: C.muted,
          letterSpacing: "0.02em",
          whiteSpace: "nowrap",
        }}
      >
        <span style={{ color: C.accent }}>{">"}</span>{" "}
        {prompt.slice(0, charsVisible)}
        <span style={{ opacity: cursorBlink, color: C.accent, marginLeft: 2 }}>
          |
        </span>
      </div>

      {/* Title */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: `translate(-50%, -50%) translateY(${titleY}px)`,
          opacity: titleSpring,
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: 88,
            fontWeight: 700,
            color: C.text,
            lineHeight: 1.0,
            letterSpacing: "-0.04em",
          }}
        >
          Pneuma Skills
        </div>
      </div>

      {/* Subtitle + line */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: `translate(-50%, 40px) translateY(${subY}px)`,
          opacity: subSpring,
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 14,
        }}
      >
        <div
          style={{
            width: lineW,
            height: 2,
            backgroundColor: C.accent,
          }}
        />
        <div
          style={{
            fontFamily: FONT_BODY,
            fontSize: 21,
            fontWeight: 300,
            color: C.muted,
            letterSpacing: "0.05em",
          }}
        >
          Co-creation infrastructure for humans & AI
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ═══════════════════════════════════════════════════════════
// Scene 2: The Problem — fragments drifting apart
// ═══════════════════════════════════════════════════════════
const SceneProblem: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const lines = [
    { text: "You type a prompt.", delay: 0.2 },
    { text: "AI generates a response.", delay: 0.7 },
    { text: "You copy. You paste. You adjust.", delay: 1.2 },
    { text: "You do it again.", delay: 1.7 },
  ];

  const drift = interpolate(frame, [2.2 * fps, 3.5 * fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.quad),
  });

  const exit = sceneExit(frame, fps, 5);

  return (
    <AbsoluteFill style={{ backgroundColor: C.bg, opacity: exit }}>
      {/* Decorative vertical line */}
      <div
        style={{
          position: "absolute",
          left: 90,
          top: 160,
          width: 2,
          height: interpolate(frame, [0, 1.5 * fps], [0, 340], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: expoOut,
          }),
          backgroundColor: C.faint,
          opacity: 1 - drift * 0.7,
        }}
      />

      <div style={{ position: "absolute", left: 130, top: 175 }}>
        {lines.map((line, i) => {
          const s = springIn(frame, fps, line.delay);
          const slideY = interpolate(s, [0, 1], [25, 0]);
          const driftX = drift * (i % 2 === 0 ? -80 : 50) * (i * 0.5 + 0.5);
          const driftRot = drift * (i % 2 === 0 ? -2 : 1.5);
          const driftOp = interpolate(drift, [0.2, 1], [1, 0.08], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });

          return (
            <div
              key={i}
              style={{
                fontFamily: FONT_BODY,
                fontSize: 34,
                fontWeight: 400,
                color: C.text,
                lineHeight: 2,
                opacity: s * driftOp,
                transform: `translateY(${slideY}px) translateX(${driftX}px) rotate(${driftRot}deg)`,
              }}
            >
              {line.text}
            </div>
          );
        })}
      </div>

      {/* "disconnected" — italic serif, bottom right */}
      <div
        style={{
          position: "absolute",
          right: 100,
          bottom: 130,
          fontFamily: FONT_DISPLAY,
          fontStyle: "italic",
          fontSize: 72,
          fontWeight: 300,
          color: C.faint,
          opacity: interpolate(frame, [2.5 * fps, 3.2 * fps], [0, 0.7], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          letterSpacing: "-0.03em",
          transform: `translateX(${interpolate(frame, [2.5 * fps, 3.2 * fps], [40, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: expoOut })}px)`,
        }}
      >
        disconnected
      </div>
    </AbsoluteFill>
  );
};

// ═══════════════════════════════════════════════════════════
// Scene 3: The Shift — convergence illustration + overlay text
// ═══════════════════════════════════════════════════════════
const SceneShift: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Image reveals via clip-path from center
  const revealProg = interpolate(frame, [0.3 * fps, 2 * fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: expoOut,
  });
  const clipInset = interpolate(revealProg, [0, 1], [50, 0]);

  // Ken Burns: slow zoom + slight drift
  const imgScale = interpolate(frame, [0, 9 * fps], [1.05, 1.15], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const imgX = interpolate(frame, [0, 9 * fps], [0, -15], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Question text
  const qSpring = springIn(frame, fps, 0.8);
  const qY = interpolate(qSpring, [0, 1], [30, 0]);

  // "One workspace" reveal
  const owSpring = springIn(frame, fps, 2.5);
  const owY = interpolate(owSpring, [0, 1], [40, 0]);

  // Accent line
  const lineW = interpolate(frame, [3 * fps, 4.5 * fps], [0, 180], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: expoOut,
  });

  const exit = sceneExit(frame, fps, 7);

  return (
    <AbsoluteFill style={{ backgroundColor: C.bg, opacity: exit }}>
      {/* Full-bleed illustration with clip reveal */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          clipPath: `inset(${clipInset}%)`,
          overflow: "hidden",
        }}
      >
        <Img
          src={staticFile("shift-convergence_2.png")}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: `scale(${imgScale}) translateX(${imgX}px)`,
          }}
        />
        {/* Overlay gradient for text legibility */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(135deg, rgba(244,239,232,0.85) 0%, rgba(244,239,232,0.4) 45%, rgba(244,239,232,0.0) 70%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(to top, rgba(244,239,232,0.9) 0%, rgba(244,239,232,0) 40%)",
          }}
        />
      </div>

      {/* Question */}
      <div
        style={{
          position: "absolute",
          top: 80,
          left: 80,
          fontFamily: FONT_DISPLAY,
          fontStyle: "italic",
          fontSize: 42,
          fontWeight: 300,
          color: C.text,
          opacity: qSpring,
          transform: `translateY(${qY}px)`,
          letterSpacing: "-0.01em",
        }}
      >
        What if you created
        <br />
        <span style={{ fontWeight: 500, fontStyle: "normal", color: C.accent }}>
          together?
        </span>
      </div>

      {/* "One workspace" — bottom right, large */}
      <div
        style={{
          position: "absolute",
          bottom: 80,
          right: 80,
          textAlign: "right",
          opacity: owSpring,
          transform: `translateY(${owY}px)`,
        }}
      >
        <div
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: 78,
            fontWeight: 700,
            color: C.text,
            letterSpacing: "-0.04em",
            lineHeight: 1.0,
          }}
        >
          One workspace.
        </div>
        <div
          style={{
            height: 3,
            width: lineW,
            backgroundColor: C.accent,
            marginTop: 14,
            marginLeft: "auto",
          }}
        />
        <div
          style={{
            fontFamily: FONT_BODY,
            fontSize: 20,
            fontWeight: 300,
            color: C.muted,
            marginTop: 10,
            opacity: interpolate(frame, [3.5 * fps, 4.5 * fps], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        >
          Agent edits files. You see results. Simultaneously.
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ═══════════════════════════════════════════════════════════
// Pillar Component — illustration + text with rich animation
// ═══════════════════════════════════════════════════════════
type PillarProps = {
  number: string;
  title: string;
  subtitle: string;
  description: string;
  imageSrc: string;
  imageAlign: "left" | "right";
};

const Pillar: React.FC<PillarProps> = ({
  number,
  title,
  subtitle,
  description,
  imageSrc,
  imageAlign,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const isLeft = imageAlign === "left";

  // Image reveal — slides in from its side with spring
  const imgSpring = springIn(frame, fps, 0.2, { damping: 100 });
  const imgSlide = interpolate(imgSpring, [0, 1], [isLeft ? -120 : 120, 0]);
  // Ken Burns on image
  const imgScale = interpolate(frame, [0, 5.5 * fps], [1.0, 1.08], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Number watermark
  const numSpring = springIn(frame, fps, 0.1, { damping: 80, stiffness: 60 });
  const numScale = interpolate(numSpring, [0, 1], [0.7, 1]);

  // Text elements stagger in
  const titleSpring = springIn(frame, fps, 0.6);
  const titleY = interpolate(titleSpring, [0, 1], [30, 0]);

  const subSpring = springIn(frame, fps, 0.9);
  const subY = interpolate(subSpring, [0, 1], [20, 0]);

  const descAnim = fadeSlideUp(frame, fps, {
    delay: 1.3,
    duration: 0.5,
    distance: 18,
  });

  // Accent bar
  const barW = interpolate(frame, [0.7 * fps, 1.8 * fps], [0, 60], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: expoOut,
  });

  const exit = sceneExit(frame, fps, 6);

  // Layout: image takes ~55%, text takes ~45%
  const imgSide = isLeft ? { left: 0 } : { right: 0 };
  const textSide = isLeft
    ? { right: 60, left: "auto", textAlign: "left" as const }
    : { left: 60, right: "auto", textAlign: "left" as const };

  return (
    <AbsoluteFill style={{ backgroundColor: C.bg, opacity: exit }}>
      {/* Large background number watermark */}
      <div
        style={{
          position: "absolute",
          ...(isLeft ? { right: 50 } : { left: 50 }),
          top: -20,
          fontFamily: FONT_DISPLAY,
          fontSize: 300,
          fontWeight: 700,
          color: C.text,
          opacity: numSpring * 0.06,
          transform: `scale(${numScale})`,
          lineHeight: 1,
          letterSpacing: "-0.05em",
          zIndex: 0,
        }}
      >
        {number}
      </div>

      {/* Illustration */}
      <div
        style={{
          position: "absolute",
          ...imgSide,
          top: 40,
          bottom: 40,
          width: "50%",
          overflow: "hidden",
          borderRadius: isLeft ? "0 16px 16px 0" : "16px 0 0 16px",
          opacity: imgSpring,
          transform: `translateX(${imgSlide}px)`,
          zIndex: 1,
        }}
      >
        <Img
          src={staticFile(imageSrc)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: `scale(${imgScale})`,
          }}
        />
      </div>

      {/* Text content */}
      <div
        style={{
          position: "absolute",
          ...textSide,
          top: 0,
          bottom: 0,
          width: "42%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          zIndex: 2,
          paddingLeft: isLeft ? 0 : 20,
          paddingRight: isLeft ? 20 : 0,
        }}
      >
        {/* Accent bar */}
        <div
          style={{
            height: 3,
            width: barW,
            backgroundColor: C.accent,
            marginBottom: 20,
          }}
        />

        {/* Title */}
        <div
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: 48,
            fontWeight: 700,
            color: C.text,
            letterSpacing: "-0.03em",
            lineHeight: 1.1,
            opacity: titleSpring,
            transform: `translateY(${titleY}px)`,
          }}
        >
          {title}
        </div>

        {/* Subtitle */}
        <div
          style={{
            fontFamily: FONT_DISPLAY,
            fontStyle: "italic",
            fontSize: 22,
            fontWeight: 300,
            color: C.accent,
            marginTop: 10,
            opacity: subSpring,
            transform: `translateY(${subY}px)`,
          }}
        >
          {subtitle}
        </div>

        {/* Description */}
        <div
          style={{
            fontFamily: FONT_BODY,
            fontSize: 19,
            fontWeight: 300,
            color: C.muted,
            marginTop: 18,
            lineHeight: 1.65,
            opacity: descAnim.opacity,
            transform: `translateY(${descAnim.y}px)`,
            maxWidth: 420,
          }}
        >
          {description}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const PillarVisualEnv: React.FC = () => (
  <Pillar
    number="01"
    title="Visual Environment"
    subtitle="Same canvas, same moment"
    description="The agent edits files on disk. You see rendered results instantly in a live preview panel. Not chat — a shared workspace where both forces create simultaneously."
    imageSrc="pillar-visual-env_1.png"
    imageAlign="left"
  />
);

const PillarSkills: React.FC = () => (
  <Pillar
    number="02"
    title="Skills"
    subtitle="Domain knowledge, on demand"
    description="Inject specialized expertise per creative mode. The agent doesn't just write code — it understands your domain, your tools, your design language."
    imageSrc="pillar-skills_1.png"
    imageAlign="right"
  />
);

const PillarLearning: React.FC = () => (
  <Pillar
    number="03"
    title="Continuous Learning"
    subtitle="Every session refines the next"
    description="An Evolution Agent mines your collaborative history. It extracts preferences, adapts behaviors, and proposes improvements — all under your control."
    imageSrc="pillar-learning.png"
    imageAlign="left"
  />
);

const PillarDistribution: React.FC = () => (
  <Pillar
    number="04"
    title="Distribution"
    subtitle="Create, share, evolve"
    description="Build custom modes with AI. Publish to a marketplace. Share workflows as replay packages. Knowledge compounds across the community."
    imageSrc="pillar-distribution_1.png"
    imageAlign="right"
  />
);

// ═══════════════════════════════════════════════════════════
// Scene 5: Vision — matter.js physics (CDN) blocks + text
// ═══════════════════════════════════════════════════════════

const MATTER_CDN = "https://cdnjs.cloudflare.com/ajax/libs/matter-js/0.20.0/matter.min.js";

const MODE_BLOCKS = [
  // Tagline — pure text, drops among the pile
  { label: "Limitless creativity.", w: 320, h: 72, isFeature: false, hue: 25, icon: "", isTagline: true },
  // Built-in modes — generous sizing
  { label: "Webcraft",    w: 200, h: 72, isFeature: false, hue: 32,  icon: "</>" },
  { label: "Slide",       w: 160, h: 68, isFeature: false, hue: 15,  icon: "\u25A1" },
  { label: "Doc",         w: 130, h: 66, isFeature: false, hue: 140, icon: "\u00B6" },
  { label: "Draw",        w: 150, h: 68, isFeature: false, hue: 210, icon: "\u25CB" },
  { label: "Illustrate",  w: 190, h: 70, isFeature: false, hue: 330, icon: "\u2606" },
  { label: "Remotion",    w: 185, h: 72, isFeature: false, hue: 18,  icon: "\u25B6" },
  // Feature modes — larger, distinctive
  { label: "Mode Maker",  w: 220, h: 76, isFeature: true,  hue: 42,  icon: "\u2692" },
  { label: "Evolve",      w: 175, h: 74, isFeature: true,  hue: 280, icon: "\u21BB" },
  // Sub-capabilities — fill out the pile
  { label: "Preview",     w: 155, h: 64, isFeature: false, hue: 50,  icon: "\u25B7" },
  { label: "Terminal",    w: 165, h: 64, isFeature: false, hue: 180, icon: ">" },
  { label: "Replay",      w: 145, h: 64, isFeature: false, hue: 300, icon: "\u21BA" },
  { label: "Templates",   w: 175, h: 66, isFeature: false, hue: 60,  icon: "\u2736" },
  { label: "Marketplace", w: 195, h: 68, isFeature: false, hue: 240, icon: "\u2606" },
];

// Snapshot: { x, y, angle, visible }

function runMatterSim(M: any): any[][] {
  const FRAMES = 330; // 11 seconds at 30fps
  const W = 1280;
  const GROUND_Y = 620;

  const engine = M.Engine.create({ gravity: { x: 0, y: 1.2 } });

  // Static walls: ground + left invisible wall (blocks pile right)
  const ground = M.Bodies.rectangle(W / 2, GROUND_Y + 30, W, 60, { isStatic: true, friction: 0.9, restitution: 0.1 });
  const wallL = M.Bodies.rectangle(380, 400, 60, 800, { isStatic: true }); // left boundary at ~400px
  const wallR = M.Bodies.rectangle(W + 30, 400, 60, 800, { isStatic: true });
  M.Composite.add(engine.world, [ground, wallL, wallR]);

  // Create block bodies — staggered drop
  const blocks = MODE_BLOCKS.map((def, i) => {
    const x = 580 + Math.random() * 560;
    const body = M.Bodies.rectangle(x, -60 - i * 50, def.w, def.h, {
      restitution: 0.15,
      friction: 0.7,
      frictionAir: 0.008,
      angle: (Math.random() - 0.5) * 0.3,
      chamfer: { radius: def.isFeature ? 10 : 4 },
    });
    const isTagline = (def as any).isTagline;
    // Stagger: tagline at ~3s, built-in modes cascade, features last, extras fill gaps
    const dropFrame = isTagline
      ? 85 + Math.floor(Math.random() * 4)
      : def.isFeature
        ? 140 + (i - 8) * 16 + Math.floor(Math.random() * 6)
        : i <= 7
          ? 15 + (i - 1) * 10 + Math.floor(Math.random() * 5) // built-in modes
          : 100 + (i - 10) * 12 + Math.floor(Math.random() * 6); // extras
    return { body, dropFrame, added: false };
  });

  const frames: any[][] = [];

  for (let f = 0; f < FRAMES; f++) {
    // Add bodies at drop time
    for (const b of blocks) {
      if (f >= b.dropFrame && !b.added) {
        M.Composite.add(engine.world, b.body);
        b.added = true;
      }
    }
    M.Engine.update(engine, 1000 / 30);
    frames.push(
      blocks.map((b) => ({
        x: b.body.position.x,
        y: b.body.position.y,
        angle: b.body.angle,
        visible: b.added,
      }))
    );
  }

  M.Engine.clear(engine);
  return frames;
}

// Load matter.js from CDN once, shared across mounts
let matterPromise: Promise<any> | null = null;
function loadMatter(): Promise<any> {
  if ((window as any).Matter) return Promise.resolve((window as any).Matter);
  if (matterPromise) return matterPromise;
  matterPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = MATTER_CDN;
    s.onload = () => resolve((window as any).Matter);
    s.onerror = reject;
    document.head.appendChild(s);
  });
  return matterPromise;
}

const SceneVision: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const [sim, setSim] = React.useState<any>(null);
  const ranRef = React.useRef(false);

  React.useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    loadMatter().then((M) => setSim(runMatterSim(M)));
  }, []);

  const bgIn = interpolate(frame, [0, 0.5 * fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const exit = sceneExit(frame, fps, 11);

  // Vision text
  const lines = [
    { text: "Open source.", delay: 0.4, weight: 300, size: 54 },
    { text: "Framework, not SaaS.", delay: 1.1, weight: 700, size: 68 },
    { text: "Your workspace.", delay: 2.0, weight: 300, size: 54 },
    { text: "Your agent.", delay: 2.5, weight: 300, size: 54 },
    { text: "Your rules.", delay: 3.0, weight: 500, size: 58 },
  ];

  const groundW = interpolate(frame, [0.2 * fps, 1.2 * fps], [0, 700], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: expoOut,
  });

  const snapshot = sim ? sim[Math.min(frame, sim.length - 1)] : null;

  return (
    <AbsoluteFill style={{ backgroundColor: C.bg }}>
      {/* Dark bg */}
      <div style={{ position: "absolute", inset: 0, backgroundColor: C.bgDark, opacity: bgIn * exit }} />

      {/* Ground line */}
      <div style={{
        position: "absolute", bottom: 100, right: 60, width: groundW, height: 1,
        backgroundColor: C.muted, opacity: 0.15 * exit,
      }} />

      {/* Matter.js blocks */}
      {snapshot && (
        <div style={{ opacity: exit }}>
          {snapshot.map((snap, i) => {
            if (!snap.visible) return null;
            const def = MODE_BLOCKS[i];
            const isTagline = !!(def as any).isTagline;

            // Tagline: pure text block, no background — 阳刻 style
            if (isTagline) {
              return (
                <div
                  key={i}
                  style={{
                    position: "absolute",
                    left: snap.x - def.w / 2,
                    top: snap.y - def.h / 2,
                    width: def.w,
                    height: def.h,
                    transform: `rotate(${snap.angle}rad)`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <span style={{
                    fontFamily: FONT_DISPLAY, fontSize: 32, fontWeight: 700,
                    color: C.accent, letterSpacing: "-0.03em", whiteSpace: "nowrap",
                    lineHeight: 1,
                  }}>
                    {def.label}
                  </span>
                </div>
              );
            }

            // Mode cards: muted tinted glass
            const chroma = def.isFeature ? 0.022 : 0.012;
            const base = def.isFeature ? 22 : 19;
            const border = def.isFeature ? 34 : 28;
            const text = def.isFeature ? 56 : 48;

            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: snap.x - def.w / 2,
                  top: snap.y - def.h / 2,
                  width: def.w,
                  height: def.h,
                  transform: `rotate(${snap.angle}rad)`,
                  borderRadius: def.isFeature ? 14 : 7,
                  background: `linear-gradient(165deg, oklch(${base + 3}% ${chroma} ${def.hue}) 0%, oklch(${base}% ${chroma * 0.5} ${def.hue}) 100%)`,
                  border: def.isFeature
                    ? `1.5px solid oklch(${border}% ${chroma * 2.5} ${def.hue})`
                    : `1px solid oklch(${border}% ${chroma * 1.5} ${def.hue})`,
                  boxShadow: `0 2px 8px rgba(0,0,0,0.35), inset 0 1px 0 oklch(${base + 5}% ${chroma * 0.3} ${def.hue} / 0.2)`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                }}
              >
                <div style={{
                  position: "absolute", top: 0, left: 0, right: 0, height: 1,
                  background: `linear-gradient(90deg, transparent, oklch(${border + 6}% ${chroma * 0.5} ${def.hue} / 0.15), transparent)`,
                }} />
                <span style={{
                  fontFamily: FONT_BODY, fontSize: def.isFeature ? 16 : 14,
                  color: `oklch(${text - 12}% ${chroma * 1.5} ${def.hue})`,
                  opacity: 0.5, lineHeight: 1,
                }}>
                  {def.icon}
                </span>
                <span style={{
                  fontFamily: FONT_DISPLAY,
                  fontSize: def.isFeature ? 17 : 15,
                  fontWeight: def.isFeature ? 500 : 400,
                  fontStyle: def.isFeature ? "italic" : "normal",
                  color: `oklch(${text}% ${chroma * 1.2} ${def.hue})`,
                  letterSpacing: "0.02em", whiteSpace: "nowrap",
                }}>
                  {def.label}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Vision text */}
      <div style={{ position: "absolute", left: 100, top: 110, maxWidth: 560, opacity: exit }}>
        {lines.map((line, i) => {
          const s = springIn(frame, fps, line.delay);
          const y = interpolate(s, [0, 1], [20, 0]);
          return (
            <div key={i} style={{
              fontFamily: FONT_DISPLAY, fontSize: line.size, fontWeight: line.weight,
              color: i === 1 ? C.accent : C.textLight,
              lineHeight: 1.4, letterSpacing: "-0.03em", opacity: s, transform: `translateY(${y}px)`,
            }}>
              {line.text}
            </div>
          );
        })}
      </div>

      {/* MIT badge */}
      <div style={{
        position: "absolute", bottom: 75, right: 80,
        fontFamily: FONT_BODY, fontSize: 14, fontWeight: 300,
        color: C.muted, letterSpacing: "0.08em",
        opacity: interpolate(frame, [5 * fps, 6 * fps], [0, 0.5], {
          extrapolateLeft: "clamp", extrapolateRight: "clamp",
        }) * exit,
        textTransform: "uppercase" as const,
      }}>
        MIT Licensed
      </div>
    </AbsoluteFill>
  );
};

// ═══════════════════════════════════════════════════════════
// Scene 6: Outro — logo + GitHub
// ═══════════════════════════════════════════════════════════
const SceneOutro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Logo image enters with scale + rotation
  const logoImgSpring = springIn(frame, fps, 0.2, { damping: 12, stiffness: 100 });
  const logoImgScale = interpolate(logoImgSpring, [0, 1], [0.3, 1]);
  const logoImgRot = interpolate(logoImgSpring, [0, 1], [-15, 0]);

  // Wordmark
  const logoSpring = springIn(frame, fps, 0.7);
  const logoY = interpolate(logoSpring, [0, 1], [30, 0]);

  // Accent line under wordmark
  const lineW = interpolate(frame, [1.0 * fps, 1.8 * fps], [0, 180], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: expoOut,
  });

  // URL
  const urlSpring = springIn(frame, fps, 1.4);
  const urlY = interpolate(urlSpring, [0, 1], [20, 0]);

  // Tagline
  const tagSpring = springIn(frame, fps, 2.0);

  // Decorative ring — slow pulse
  const ringScale = interpolate(frame, [0.5 * fps, 5 * fps], [0.6, 1.05], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: expoOut,
  });
  const ringOpacity = interpolate(frame, [0.5 * fps, 1.5 * fps], [0, 0.12], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Second ring — offset timing for depth
  const ring2Scale = interpolate(frame, [1.5 * fps, 6 * fps], [0.4, 0.85], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: expoOut,
  });
  const ring2Opacity = interpolate(frame, [1.5 * fps, 2.5 * fps], [0, 0.08], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Fade to black
  const fadeOut = interpolate(frame, [5.5 * fps, 7.5 * fps], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.in(Easing.quad),
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: C.bg,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      {/* Decorative rings */}
      <div
        style={{
          position: "absolute",
          width: 400,
          height: 400,
          borderRadius: "50%",
          border: `1.5px solid ${C.faint}`,
          transform: `scale(${ringScale})`,
          opacity: ringOpacity * fadeOut,
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 400,
          height: 400,
          borderRadius: "50%",
          border: `1px solid ${C.faint}`,
          transform: `scale(${ring2Scale})`,
          opacity: ring2Opacity * fadeOut,
        }}
      />

      {/* Pneuma logo */}
      <Img
        src={staticFile("pneuma-logo.png")}
        style={{
          position: "absolute",
          top: 220,
          width: 100,
          height: 100,
          objectFit: "contain",
          transform: `scale(${logoImgScale}) rotate(${logoImgRot}deg)`,
          opacity: logoImgSpring * fadeOut,
        }}
      />

      {/* Wordmark */}
      <div
        style={{
          opacity: logoSpring * fadeOut,
          transform: `translateY(${logoY}px)`,
          textAlign: "center",
          marginTop: 50,
        }}
      >
        <div
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: 80,
            fontWeight: 700,
            color: C.text,
            letterSpacing: "-0.04em",
            lineHeight: 1,
          }}
        >
          pneuma
          <span style={{ color: C.accent, fontWeight: 300 }}>-</span>
          skills
        </div>
        {/* Accent line */}
        <div style={{
          width: lineW, height: 2, backgroundColor: C.accent,
          margin: "16px auto 0",
        }} />
      </div>

      {/* GitHub URL */}
      <div
        style={{
          position: "absolute",
          bottom: 195,
          opacity: urlSpring * fadeOut,
          transform: `translateY(${urlY}px)`,
        }}
      >
        <div
          style={{
            fontFamily: FONT_BODY,
            fontSize: 22,
            fontWeight: 400,
            color: C.muted,
            letterSpacing: "0.04em",
          }}
        >
          github.com/pandazki/pneuma-skills
        </div>
      </div>

      {/* Tagline */}
      <div
        style={{
          position: "absolute",
          bottom: 150,
          opacity: tagSpring * fadeOut,
        }}
      >
        <div
          style={{
            fontFamily: FONT_DISPLAY,
            fontStyle: "italic",
            fontSize: 18,
            fontWeight: 300,
            color: C.faint,
            letterSpacing: "0.02em",
          }}
        >
          Isomorphic collaboration between humans & AI agents
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ═══════════════════════════════════════════════════════════
// Main Composition — 60 seconds
// ═══════════════════════════════════════════════════════════
export const PneumaIntro: React.FC = () => {
  const fps = 30;

  // Durations in seconds
  // Balanced: open 17.5s, pillars 24s, vision 11s, outro 7.5s = 60s
  const durations = [5.5, 5, 7, 6, 6, 6, 6, 11, 7.5];
  const starts: number[] = [];
  let t = 0;
  for (const d of durations) {
    starts.push(t * fps);
    t += d;
  }

  return (
    <AbsoluteFill style={{ backgroundColor: C.bg }}>
      <style>{fontCSS}</style>

      <Sequence from={starts[0]} durationInFrames={durations[0] * fps}>
        <SceneColdOpen />
      </Sequence>

      <Sequence from={starts[1]} durationInFrames={durations[1] * fps}>
        <SceneProblem />
      </Sequence>

      <Sequence from={starts[2]} durationInFrames={durations[2] * fps}>
        <SceneShift />
      </Sequence>

      <Sequence from={starts[3]} durationInFrames={durations[3] * fps}>
        <PillarVisualEnv />
      </Sequence>

      <Sequence from={starts[4]} durationInFrames={durations[4] * fps}>
        <PillarSkills />
      </Sequence>

      <Sequence from={starts[5]} durationInFrames={durations[5] * fps}>
        <PillarLearning />
      </Sequence>

      <Sequence from={starts[6]} durationInFrames={durations[6] * fps}>
        <PillarDistribution />
      </Sequence>

      <Sequence from={starts[7]} durationInFrames={durations[7] * fps}>
        <SceneVision />
      </Sequence>

      <Sequence from={starts[8]} durationInFrames={durations[8] * fps}>
        <SceneOutro />
      </Sequence>
    </AbsoluteFill>
  );
};
