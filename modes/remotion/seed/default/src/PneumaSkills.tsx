/*
 * Pneuma Skills — 45s Highlight Video (v2)
 * Design: Editorial + Diagrammatic
 * 8 scenes, each with a visual centerpiece
 */

import React, { useEffect } from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  Sequence,
  Easing,
  Img,
  staticFile,
} from "remotion";

// ─── Palette ────────────────────────────────────────────────
const C = {
  bg: "#f5f0e8",
  bgAlt: "#faf7f2",
  dark: "#2a2420",
  textLight: "#6b5e54",
  accent: "#c4593c",
  sage: "#5e8a72",
  cream: "#faf7f2",
};

const SERIF = "'Playfair Display', Georgia, serif";
const SANS = "'DM Sans', 'Helvetica Neue', sans-serif";

const useFonts = () => {
  useEffect(() => {
    const link = document.createElement("link");
    link.href =
      "https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400&display=swap";
    link.rel = "stylesheet";
    document.head.appendChild(link);
    return () => void link.remove();
  }, []);
};

// ─── Animation helpers ──────────────────────────────────────
const expoOut = Easing.out(Easing.exp);
const expoIn = Easing.in(Easing.exp);
const CL = {
  extrapolateLeft: "clamp" as const,
  extrapolateRight: "clamp" as const,
};

const fadeIn = (f: number, start: number, dur: number, dist = 40, dir: "up" | "left" = "up") => {
  const opacity = interpolate(f, [start, start + dur], [0, 1], { ...CL, easing: expoOut });
  const d = interpolate(f, [start, start + dur], [dist, 0], { ...CL, easing: expoOut });
  return { opacity, transform: dir === "up" ? `translateY(${d}px)` : `translateX(${-d}px)` };
};

const fadeOut = (f: number, start: number, dur: number) =>
  interpolate(f, [start, start + dur], [1, 0], { ...CL, easing: expoIn });

// ═══════════════════════════════════════════════════════════
// Scene 1: Opening (0–4s, 120 frames)
// Pneuma mark + etymology bg + title
// ═══════════════════════════════════════════════════════════
const Opening: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const markSpring = spring({ frame: frame - 5, fps, config: { damping: 200, stiffness: 80 } });
  const bgOp = interpolate(frame, [0, fps], [0, 0.2], { ...CL, easing: expoOut });
  const titleClip = interpolate(frame, [0.6 * fps, 1.3 * fps], [100, 0], { ...CL, easing: expoOut });
  const sub = fadeIn(frame, 1.4 * fps, 0.6 * fps, 20);
  const lineW = interpolate(frame, [0.8 * fps, 1.6 * fps], [0, 100], { ...CL, easing: expoOut });
  const exit = fadeOut(frame, 3.2 * fps, 0.6 * fps);

  return (
    <AbsoluteFill style={{ backgroundColor: C.bg, opacity: exit }}>
      {/* Etymology watercolor bg — right side, subtle */}
      <Img
        src={staticFile("etymology.png")}
        style={{
          position: "absolute",
          right: -60,
          top: "50%",
          width: 600,
          height: "auto",
          transform: `translateY(-50%) scale(${0.95 + 0.05 * markSpring})`,
          opacity: bgOp,
          objectFit: "contain",
        }}
      />

      {/* Center content */}
      <div
        style={{
          position: "absolute",
          left: 140,
          top: "50%",
          transform: "translateY(-55%)",
        }}
      >
        {/* Pneuma logo */}
        <Img
          src={staticFile("pneuma-logo.png")}
          style={{
            width: 120,
            height: "auto",
            marginBottom: 28,
            opacity: markSpring,
            transform: `scale(${0.7 + 0.3 * markSpring})`,
            objectFit: "contain",
          }}
        />

        {/* Accent line */}
        <div style={{ width: lineW, height: 3, backgroundColor: C.accent, marginBottom: 36 }} />

        {/* Title clip reveal */}
        <div style={{ overflow: "hidden" }}>
          <div
            style={{
              fontFamily: SERIF,
              fontSize: 120,
              fontWeight: 900,
              color: C.dark,
              letterSpacing: "-0.03em",
              lineHeight: 1,
              transform: `translateY(${titleClip}%)`,
            }}
          >
            pneuma
          </div>
        </div>

        {/* Subtitle */}
        <div
          style={{
            fontFamily: SANS,
            fontSize: 18,
            fontWeight: 500,
            color: C.accent,
            marginTop: 20,
            letterSpacing: "0.12em",
            textTransform: "uppercase" as const,
            ...sub,
          }}
        >
          Co-creation infrastructure for humans & agents
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ═══════════════════════════════════════════════════════════
// Scene 2: The Gap (4–9s, 150 frames)
// Animated chat bubbles showing describe→wait→describe cycle
// ═══════════════════════════════════════════════════════════
const TheGap: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Chat bubbles appear staggered
  const bubbles = [
    { text: "Make the header bigger", delay: 0.3 * fps, side: "right" as const },
    { text: "Done. I've updated the header font size.", delay: 1.0 * fps, side: "left" as const },
    { text: "No, I meant the logo, not the text", delay: 1.8 * fps, side: "right" as const },
    { text: "Which logo? The one in the nav or the hero?", delay: 2.5 * fps, side: "left" as const },
    { text: "The hero. And also change the...", delay: 3.2 * fps, side: "right" as const },
  ];

  // Typing dots (shows between bubble 1 and 2)
  const dotsVisible = interpolate(frame, [0.7 * fps, 0.8 * fps, 0.95 * fps, 1.0 * fps], [0, 1, 1, 0], CL);
  const dotCycle = frame % 24;
  const dot1 = interpolate(dotCycle, [0, 6, 12], [0.3, 1, 0.3], CL);
  const dot2 = interpolate(dotCycle, [4, 10, 16], [0.3, 1, 0.3], CL);
  const dot3 = interpolate(dotCycle, [8, 14, 20], [0.3, 1, 0.3], CL);

  // Problem text
  const problemText = fadeIn(frame, 3.5 * fps, 0.7 * fps, 30);

  // Exit
  const exit = fadeOut(frame, 4.2 * fps, 0.6 * fps);

  return (
    <AbsoluteFill style={{ backgroundColor: C.dark, opacity: exit }}>
      {/* Chat area */}
      <div
        style={{
          position: "absolute",
          left: 300,
          top: 80,
          width: 680,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        {bubbles.map((b, i) => {
          const bSpring = spring({
            frame: frame - Math.round(b.delay),
            fps,
            config: { damping: 200, stiffness: 150 },
          });
          const isUser = b.side === "right";
          return (
            <div
              key={i}
              style={{
                alignSelf: isUser ? "flex-end" : "flex-start",
                maxWidth: 420,
                padding: "14px 20px",
                borderRadius: isUser ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
                backgroundColor: isUser ? C.accent : "rgba(245,240,232,0.1)",
                opacity: bSpring,
                transform: `translateY(${15 * (1 - bSpring)}px)`,
              }}
            >
              <div
                style={{
                  fontFamily: SANS,
                  fontSize: 16,
                  color: isUser ? C.cream : "rgba(245,240,232,0.7)",
                  lineHeight: 1.4,
                }}
              >
                {b.text}
              </div>
            </div>
          );
        })}

        {/* Typing indicator */}
        <div
          style={{
            alignSelf: "flex-start",
            display: "flex",
            gap: 5,
            padding: "14px 20px",
            borderRadius: "18px 18px 18px 4px",
            backgroundColor: "rgba(245,240,232,0.1)",
            opacity: dotsVisible,
          }}
        >
          {[dot1, dot2, dot3].map((d, i) => (
            <div
              key={i}
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                backgroundColor: "rgba(245,240,232,0.5)",
                opacity: d,
              }}
            />
          ))}
        </div>
      </div>

      {/* Problem statement — left side */}
      <div
        style={{
          position: "absolute",
          left: 80,
          bottom: 100,
          ...problemText,
        }}
      >
        <div
          style={{
            fontFamily: SERIF,
            fontSize: 32,
            fontWeight: 700,
            color: C.cream,
            lineHeight: 1.4,
            maxWidth: 360,
          }}
        >
          You describe.
          <br />
          Wait.
          <br />
          <span style={{ color: C.accent }}>Describe again.</span>
        </div>
        <div
          style={{
            fontFamily: SANS,
            fontSize: 15,
            color: "rgba(245,240,232,0.35)",
            marginTop: 16,
            letterSpacing: "0.1em",
            textTransform: "uppercase" as const,
          }}
        >
          The chat-only problem
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ═══════════════════════════════════════════════════════════
// Scene 3: The Protocol (9–16s, 210 frames)
// Triangle diagram: User ↔ Viewer ↔ Agent
// ═══════════════════════════════════════════════════════════
const TheProtocol: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Node positions (triangle)
  const nodes = [
    { x: 780, y: 160, label: "User", icon: "◎", color: C.sage },
    { x: 480, y: 500, label: "Viewer", icon: "▷", color: C.accent },
    { x: 1080, y: 500, label: "Agent", icon: "</>", color: C.dark },
  ];

  // Edges with bidirectional labels
  const edges = [
    { from: 0, to: 1, labelA: "Interaction", labelB: "Rendering", delay: 1.5 * fps },
    { from: 0, to: 2, labelA: "Intent", labelB: "Response", delay: 2.5 * fps },
    { from: 2, to: 1, labelA: "Action", labelB: "Context", delay: 3.5 * fps },
  ];

  // Title
  const title = fadeIn(frame, 0.2 * fps, 0.7 * fps, 30);

  // "6" counter
  const sixSpring = spring({
    frame: frame - Math.round(4.5 * fps),
    fps,
    config: { damping: 200, stiffness: 100 },
  });

  // Exit
  const exit = fadeOut(frame, 6.2 * fps, 0.6 * fps);

  return (
    <AbsoluteFill style={{ backgroundColor: C.bg, opacity: exit }}>
      {/* Title — left side */}
      <div style={{ position: "absolute", left: 80, top: 120, ...title }}>
        <div
          style={{
            fontFamily: SANS,
            fontSize: 13,
            fontWeight: 700,
            color: C.accent,
            letterSpacing: "0.22em",
            textTransform: "uppercase" as const,
            marginBottom: 16,
          }}
        >
          Core Innovation
        </div>
        <div
          style={{
            fontFamily: SERIF,
            fontSize: 44,
            fontWeight: 900,
            color: C.dark,
            lineHeight: 1.15,
          }}
        >
          The Viewer-
          <br />
          Agent Protocol
        </div>
      </div>

      {/* "6 directions" badge */}
      <div
        style={{
          position: "absolute",
          left: 80,
          bottom: 120,
          opacity: sixSpring,
          transform: `translateY(${20 * (1 - sixSpring)}px)`,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <span style={{ fontFamily: SERIF, fontSize: 72, fontWeight: 900, color: C.accent }}>6</span>
          <span
            style={{
              fontFamily: SANS,
              fontSize: 16,
              fontWeight: 500,
              color: C.textLight,
              letterSpacing: "0.1em",
              textTransform: "uppercase" as const,
            }}
          >
            directions
          </span>
        </div>
        <div style={{ fontFamily: SANS, fontSize: 18, color: C.textLight, marginTop: 4 }}>
          Zero waiting. Both sides async.
        </div>
      </div>

      {/* SVG Diagram */}
      <svg
        width="1280"
        height="720"
        viewBox="0 0 1280 720"
        style={{ position: "absolute", top: 0, left: 0 }}
      >
        {/* Edges */}
        {edges.map((edge, i) => {
          const n1 = nodes[edge.from];
          const n2 = nodes[edge.to];
          const mx = (n1.x + n2.x) / 2;
          const my = (n1.y + n2.y) / 2;

          // Offset for two parallel lines
          const dx = n2.x - n1.x;
          const dy = n2.y - n1.y;
          const len = Math.sqrt(dx * dx + dy * dy);
          const nx = -dy / len * 10;
          const ny = dx / len * 10;

          const drawProgress = interpolate(
            frame,
            [edge.delay, edge.delay + 0.6 * fps],
            [0, 1],
            { ...CL, easing: expoOut }
          );

          const labelOp = interpolate(
            frame,
            [edge.delay + 0.4 * fps, edge.delay + 0.8 * fps],
            [0, 1],
            { ...CL, easing: expoOut }
          );

          return (
            <g key={i}>
              {/* Line A (forward) */}
              <line
                x1={n1.x + nx}
                y1={n1.y + ny}
                x2={n1.x + nx + (n2.x - n1.x) * drawProgress}
                y2={n1.y + ny + (n2.y - n1.y) * drawProgress}
                stroke={C.accent}
                strokeWidth={2}
                opacity={0.6}
              />
              {/* Line B (backward) */}
              <line
                x1={n2.x - nx}
                y1={n2.y - ny}
                x2={n2.x - nx + (n1.x - n2.x) * drawProgress}
                y2={n2.y - ny + (n1.y - n2.y) * drawProgress}
                stroke={C.sage}
                strokeWidth={2}
                opacity={0.6}
              />

              {/* Labels */}
              <text
                x={mx + nx * 2.5}
                y={my + ny * 2.5 - 4}
                textAnchor="middle"
                fill={C.accent}
                fontSize={12}
                fontFamily={SANS}
                fontWeight={500}
                opacity={labelOp}
                letterSpacing="0.08em"
              >
                {edge.labelA}
              </text>
              <text
                x={mx - nx * 2.5}
                y={my - ny * 2.5 + 14}
                textAnchor="middle"
                fill={C.sage}
                fontSize={12}
                fontFamily={SANS}
                fontWeight={500}
                opacity={labelOp}
                letterSpacing="0.08em"
              >
                {edge.labelB}
              </text>
            </g>
          );
        })}

        {/* Nodes */}
        {nodes.map((node, i) => {
          const nodeSpring = spring({
            frame: frame - Math.round(0.6 * fps + i * 0.35 * fps),
            fps,
            config: { damping: 200, stiffness: 120 },
          });

          return (
            <g key={i} opacity={nodeSpring} transform={`translate(${node.x}, ${node.y}) scale(${0.7 + 0.3 * nodeSpring})`}>
              {/* Circle bg */}
              <circle cx={0} cy={0} r={52} fill={node.color} />
              {/* Icon */}
              <text
                x={0}
                y={-4}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={C.cream}
                fontSize={24}
                fontFamily={SERIF}
              >
                {node.icon}
              </text>
              {/* Label below */}
              <text
                x={0}
                y={24}
                textAnchor="middle"
                fill={C.cream}
                fontSize={11}
                fontFamily={SANS}
                fontWeight={700}
                letterSpacing="0.15em"
                textTransform="uppercase"
                opacity={0.7}
              >
                {node.label.toUpperCase()}
              </text>
            </g>
          );
        })}
      </svg>
    </AbsoluteFill>
  );
};

// ═══════════════════════════════════════════════════════════
// Scene 4: Live Flow (16–22s, 180 frames)
// collaboration.png + 5-step animated flow
// ═══════════════════════════════════════════════════════════
const LiveFlow: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const imgSpring = spring({
    frame: frame - Math.round(0.3 * fps),
    fps,
    config: { damping: 200, stiffness: 80 },
  });

  const steps = [
    { icon: "</>", text: "Agent writes code", color: C.dark },
    { icon: "◎", text: "File watcher detects", color: C.textLight },
    { icon: "▷", text: "Viewer renders live", color: C.accent },
    { icon: "☝", text: 'You select & point', color: C.sage },
    { icon: "↩", text: "Context flows back", color: C.dark },
  ];

  const exit = fadeOut(frame, 5.2 * fps, 0.6 * fps);

  return (
    <AbsoluteFill style={{ backgroundColor: C.bgAlt, opacity: exit }}>
      {/* Collaboration illustration — left/center */}
      <Img
        src={staticFile("collaboration.png")}
        style={{
          position: "absolute",
          left: 60,
          top: "50%",
          width: 580,
          height: "auto",
          transform: `translateY(-50%) scale(${0.92 + 0.08 * imgSpring})`,
          opacity: imgSpring * 0.7,
          objectFit: "contain",
        }}
      />

      {/* Flow steps — right side */}
      <div
        style={{
          position: "absolute",
          right: 80,
          top: "50%",
          transform: "translateY(-50%)",
          width: 400,
        }}
      >
        {/* Section label */}
        <div style={{ ...fadeIn(frame, 0.2 * fps, 0.5 * fps, 15) }}>
          <div
            style={{
              fontFamily: SANS,
              fontSize: 13,
              fontWeight: 700,
              color: C.accent,
              letterSpacing: "0.22em",
              textTransform: "uppercase" as const,
              marginBottom: 28,
            }}
          >
            How It Works
          </div>
        </div>

        {/* Steps */}
        {steps.map((step, i) => {
          const delay = 0.6 * fps + i * 0.4 * fps;
          const stepSpring = spring({
            frame: frame - Math.round(delay),
            fps,
            config: { damping: 200, stiffness: 140 },
          });

          // Connector line to next step
          const lineH = i < steps.length - 1
            ? interpolate(frame, [delay + 0.3 * fps, delay + 0.6 * fps], [0, 28], { ...CL, easing: expoOut })
            : 0;

          return (
            <div key={i}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  opacity: stepSpring,
                  transform: `translateX(${20 * (1 - stepSpring)}px)`,
                }}
              >
                {/* Step number circle */}
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: "50%",
                    backgroundColor: step.color,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <span style={{ fontFamily: SERIF, fontSize: 14, color: C.cream }}>{step.icon}</span>
                </div>
                {/* Text */}
                <span style={{ fontFamily: SANS, fontSize: 18, fontWeight: 500, color: C.dark }}>
                  {step.text}
                </span>
              </div>

              {/* Connector line */}
              {i < steps.length - 1 && (
                <div
                  style={{
                    width: 2,
                    height: lineH,
                    backgroundColor: C.accent,
                    opacity: 0.25,
                    marginLeft: 17,
                    marginTop: 4,
                    marginBottom: 4,
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// ═══════════════════════════════════════════════════════════
// Scene 5: Four Pillars (22–30s, 240 frames)
// 2×2 grid, staggered card reveals
// ═══════════════════════════════════════════════════════════
const pillarsData = [
  {
    icon: "◎",
    title: "Visual Environment",
    desc: "Agent edits files. Viewer renders live. You select elements and reference them directly.",
    color: C.sage,
  },
  {
    icon: "⚡",
    title: "Skills System",
    desc: "Declarative prompts, templates, and rules injected at session start. No model retraining.",
    color: C.accent,
  },
  {
    icon: "∞",
    title: "Evolution Agent",
    desc: "Reads your conversation history. Extracts preferences. Augments skills via reasoning, not ML.",
    color: C.dark,
  },
  {
    icon: "⬡",
    title: "Distribution",
    desc: "Mode Maker: describe what you need, get a custom AI app. Publish and share on the marketplace.",
    color: C.textLight,
  },
];

const FourPillars: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleAnim = fadeIn(frame, 0.2 * fps, 0.6 * fps, 25);
  const exit = fadeOut(frame, 7.2 * fps, 0.6 * fps);

  return (
    <AbsoluteFill style={{ backgroundColor: C.bg, opacity: exit }}>
      {/* Section title */}
      <div style={{ position: "absolute", left: 80, top: 60, ...titleAnim }}>
        <div
          style={{
            fontFamily: SANS,
            fontSize: 13,
            fontWeight: 700,
            color: C.accent,
            letterSpacing: "0.22em",
            textTransform: "uppercase" as const,
            marginBottom: 12,
          }}
        >
          Architecture
        </div>
        <div style={{ fontFamily: SERIF, fontSize: 40, fontWeight: 900, color: C.dark }}>
          Four Pillars
        </div>
      </div>

      {/* 2×2 Grid */}
      <div
        style={{
          position: "absolute",
          left: 80,
          right: 80,
          top: 180,
          display: "flex",
          flexWrap: "wrap",
          gap: 20,
        }}
      >
        {pillarsData.map((p, i) => {
          const delay = 0.8 * fps + i * 0.35 * fps;
          const cardSpring = spring({
            frame: frame - Math.round(delay),
            fps,
            config: { damping: 200, stiffness: 120 },
          });

          // Highlight: each pillar gets emphasized sequentially
          const highlightStart = (1.5 + i * 1.5) * fps;
          const highlight = interpolate(
            frame,
            [highlightStart, highlightStart + 0.3 * fps, highlightStart + 1.2 * fps, highlightStart + 1.5 * fps],
            [0, 1, 1, 0],
            CL
          );

          return (
            <div
              key={i}
              style={{
                width: "calc(50% - 10px)",
                padding: "28px 32px",
                borderRadius: 16,
                backgroundColor: C.bgAlt,
                border: `2px solid ${interpolate(highlight, [0, 1], [0, 1], CL) > 0.5 ? p.color : "transparent"}`,
                opacity: cardSpring,
                transform: `translateY(${25 * (1 - cardSpring)}px) scale(${1 + 0.02 * highlight})`,
              }}
            >
              {/* Icon circle */}
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: "50%",
                  backgroundColor: p.color,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 16,
                }}
              >
                <span style={{ fontFamily: SERIF, fontSize: 20, color: C.cream }}>{p.icon}</span>
              </div>

              {/* Title */}
              <div
                style={{
                  fontFamily: SERIF,
                  fontSize: 26,
                  fontWeight: 700,
                  color: C.dark,
                  marginBottom: 8,
                }}
              >
                {p.title}
              </div>

              {/* Desc */}
              <div
                style={{
                  fontFamily: SANS,
                  fontSize: 15,
                  color: C.textLight,
                  lineHeight: 1.55,
                }}
              >
                {p.desc}
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// ═══════════════════════════════════════════════════════════
// Scene 6: Modes (30–38s, 240 frames)
// Content modes + meta modes (mode-maker, evolve) separate
// ═══════════════════════════════════════════════════════════
const contentModes = [
  { name: "webcraft", desc: "Live web dev + 20 design commands", accent: "#c4593c" },
  { name: "slide", desc: "Drag-reorder · presenter · PDF export", accent: "#b87333" },
  { name: "remotion", desc: "Programmatic video with React", accent: "#d4a846" },
  { name: "doc", desc: "Markdown with live rendered preview", accent: "#8b7355" },
  { name: "draw", desc: "Excalidraw canvas for diagramming", accent: "#5e8a72" },
  { name: "illustrate", desc: "AI image studio · row-based canvas", accent: "#7a6b8a" },
];

const metaModes = [
  { name: "mode-maker", desc: "Describe what you need → get a custom AI mode", icon: "⚙" },
  { name: "evolve", desc: "Analyze conversation history → augment skills automatically", icon: "∞" },
];

const ModesScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const labelOp = interpolate(frame, [0, 0.4 * fps], [0, 1], { ...CL, easing: expoOut });
  const exit = fadeOut(frame, 7.2 * fps, 0.6 * fps);

  // Meta section label
  const metaLabel = fadeIn(frame, 2.5 * fps, 0.5 * fps, 15);

  return (
    <AbsoluteFill style={{ backgroundColor: C.dark, opacity: exit }}>
      {/* Header */}
      <div
        style={{
          position: "absolute",
          left: 80,
          top: 50,
          opacity: labelOp,
        }}
      >
        <div
          style={{
            fontFamily: SANS,
            fontSize: 13,
            fontWeight: 700,
            color: C.cream,
            letterSpacing: "0.2em",
            textTransform: "uppercase" as const,
            opacity: 0.4,
            marginBottom: 8,
          }}
        >
          Content Modes
        </div>
      </div>

      {/* Content modes grid */}
      <div
        style={{
          position: "absolute",
          left: 80,
          right: 80,
          top: 100,
          display: "flex",
          flexWrap: "wrap",
          gap: 14,
        }}
      >
        {contentModes.map((mode, i) => {
          const delay = Math.round(0.5 * fps + i * 4);
          const cardSpring = spring({
            frame: frame - delay,
            fps,
            config: { damping: 200, stiffness: 150 },
          });

          const isHero = i === 0;
          const w = isHero ? 540 : 260;

          return (
            <div
              key={i}
              style={{
                width: w,
                padding: isHero ? "24px 28px" : "20px 24px",
                borderRadius: 14,
                backgroundColor: "rgba(245,240,232,0.04)",
                border: "1px solid rgba(245,240,232,0.08)",
                opacity: cardSpring,
                transform: `translateY(${18 * (1 - cardSpring)}px)`,
                position: "relative",
                overflow: "hidden",
              }}
            >
              {/* Color accent bar */}
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: 3,
                  backgroundColor: mode.accent,
                  opacity: 0.7,
                }}
              />
              <div
                style={{
                  fontFamily: SERIF,
                  fontSize: isHero ? 26 : 20,
                  fontWeight: 700,
                  color: C.cream,
                  marginBottom: 4,
                  paddingLeft: 8,
                }}
              >
                {mode.name}
              </div>
              <div
                style={{
                  fontFamily: SANS,
                  fontSize: 12,
                  color: "rgba(245,240,232,0.4)",
                  paddingLeft: 8,
                  lineHeight: 1.4,
                }}
              >
                {mode.desc}
              </div>
            </div>
          );
        })}
      </div>

      {/* Divider + Meta label */}
      <div
        style={{
          position: "absolute",
          left: 80,
          right: 80,
          top: 420,
          display: "flex",
          alignItems: "center",
          gap: 16,
          ...metaLabel,
        }}
      >
        <div style={{ width: 40, height: 1, backgroundColor: C.accent, opacity: 0.4 }} />
        <div
          style={{
            fontFamily: SANS,
            fontSize: 12,
            fontWeight: 700,
            color: C.accent,
            letterSpacing: "0.2em",
            textTransform: "uppercase" as const,
            opacity: 0.7,
          }}
        >
          Meta Modes — Create & Learn
        </div>
        <div style={{ flex: 1, height: 1, backgroundColor: C.accent, opacity: 0.15 }} />
      </div>

      {/* Meta modes — distinct style */}
      <div
        style={{
          position: "absolute",
          left: 80,
          right: 80,
          top: 460,
          display: "flex",
          gap: 20,
        }}
      >
        {metaModes.map((mode, i) => {
          const delay = Math.round(2.8 * fps + i * 8);
          const cardSpring = spring({
            frame: frame - delay,
            fps,
            config: { damping: 200, stiffness: 120 },
          });

          return (
            <div
              key={i}
              style={{
                flex: 1,
                padding: "22px 28px",
                borderRadius: 14,
                backgroundColor: "transparent",
                border: `1px solid ${C.accent}50`,
                opacity: cardSpring,
                transform: `translateY(${15 * (1 - cardSpring)}px)`,
                display: "flex",
                alignItems: "center",
                gap: 20,
              }}
            >
              {/* Icon */}
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: "50%",
                  backgroundColor: `${C.accent}25`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <span style={{ fontFamily: SERIF, fontSize: 22, color: C.accent }}>{mode.icon}</span>
              </div>
              <div>
                <div
                  style={{
                    fontFamily: SERIF,
                    fontSize: 22,
                    fontWeight: 700,
                    color: C.cream,
                    marginBottom: 4,
                  }}
                >
                  {mode.name}
                </div>
                <div
                  style={{
                    fontFamily: SANS,
                    fontSize: 13,
                    color: "rgba(245,240,232,0.45)",
                    lineHeight: 1.4,
                  }}
                >
                  {mode.desc}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Tech stack */}
      <div
        style={{
          position: "absolute",
          left: 80,
          bottom: 40,
          fontFamily: SANS,
          fontSize: 13,
          color: "rgba(245,240,232,0.2)",
          letterSpacing: "0.1em",
          opacity: interpolate(frame, [3 * fps, 3.8 * fps], [0, 1], CL),
        }}
      >
        TypeScript · React 19 · Bun · Hono · Electron
      </div>
    </AbsoluteFill>
  );
};

// ═══════════════════════════════════════════════════════════
// Scene 7: Vision (38–42s, 120 frames)
// Morph: 2-panel editor → full-screen app
// ═══════════════════════════════════════════════════════════
const Vision: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Morph progress: 0 = editor layout, 1 = full-screen app
  const morphProgress = interpolate(frame, [0.8 * fps, 2.0 * fps], [0, 1], { ...CL, easing: expoOut });

  // Chat panel width shrinks from 35% to 0
  const chatWidth = interpolate(morphProgress, [0, 1], [35, 0], CL);
  // Viewer panel grows from 65% to 100%
  const viewerWidth = interpolate(morphProgress, [0, 1], [65, 100], CL);

  // Agent bubble appears
  const bubbleOp = interpolate(frame, [2.0 * fps, 2.5 * fps], [0, 1], { ...CL, easing: expoOut });
  const bubbleScale = interpolate(frame, [2.0 * fps, 2.5 * fps], [0.5, 1], { ...CL, easing: expoOut });

  // Labels
  const label2x = fadeIn(frame, 0.2 * fps, 0.4 * fps, 15);
  const label3x = fadeIn(frame, 2.2 * fps, 0.5 * fps, 15);

  // Title
  const titleAnim = fadeIn(frame, 2.5 * fps, 0.6 * fps, 25);

  const exit = fadeOut(frame, 3.3 * fps, 0.5 * fps);

  return (
    <AbsoluteFill style={{ backgroundColor: C.bg, opacity: exit }}>
      {/* Version labels */}
      <div
        style={{
          position: "absolute",
          left: 80,
          top: 40,
          fontFamily: SANS,
          fontSize: 13,
          fontWeight: 700,
          color: C.accent,
          letterSpacing: "0.2em",
          textTransform: "uppercase" as const,
          ...label2x,
          opacity: (label2x.opacity as number) * (1 - morphProgress),
        }}
      >
        Pneuma 2.x — Editor Layout
      </div>
      <div
        style={{
          position: "absolute",
          left: 80,
          top: 40,
          fontFamily: SANS,
          fontSize: 13,
          fontWeight: 700,
          color: C.sage,
          letterSpacing: "0.2em",
          textTransform: "uppercase" as const,
          ...label3x,
        }}
      >
        Pneuma 3.0 — App Layout
      </div>

      {/* Mock app window */}
      <div
        style={{
          position: "absolute",
          left: 80,
          right: 80,
          top: 80,
          bottom: 160,
          borderRadius: 16,
          border: `1px solid ${C.dark}20`,
          overflow: "hidden",
          display: "flex",
          backgroundColor: C.bgAlt,
        }}
      >
        {/* Viewer panel (left in 2.x, full in 3.0) */}
        <div
          style={{
            width: `${viewerWidth}%`,
            backgroundColor: C.cream,
            padding: 24,
            display: "flex",
            flexDirection: "column",
            gap: 12,
            position: "relative",
          }}
        >
          {/* Fake rendered content */}
          <div style={{ width: "60%", height: 14, borderRadius: 7, backgroundColor: `${C.dark}15` }} />
          <div style={{ width: "80%", height: 10, borderRadius: 5, backgroundColor: `${C.dark}08` }} />
          <div style={{ width: "70%", height: 10, borderRadius: 5, backgroundColor: `${C.dark}08` }} />
          <div style={{ width: "45%", height: 10, borderRadius: 5, backgroundColor: `${C.dark}08` }} />
          <div style={{ height: 20 }} />
          <div style={{ width: "50%", height: 80, borderRadius: 8, backgroundColor: `${C.accent}15` }} />
          <div style={{ width: "90%", height: 10, borderRadius: 5, backgroundColor: `${C.dark}08` }} />
          <div style={{ width: "75%", height: 10, borderRadius: 5, backgroundColor: `${C.dark}08` }} />

          {/* Agent bubble (3.0 only) */}
          <div
            style={{
              position: "absolute",
              right: 20,
              bottom: 20,
              width: 48,
              height: 48,
              borderRadius: "50%",
              backgroundColor: C.accent,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              opacity: bubbleOp,
              transform: `scale(${bubbleScale})`,
              boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
            }}
          >
            <span style={{ fontFamily: SERIF, fontSize: 20, color: C.cream }}>⚡</span>
          </div>
        </div>

        {/* Divider */}
        <div
          style={{
            width: chatWidth > 1 ? 1 : 0,
            backgroundColor: `${C.dark}15`,
          }}
        />

        {/* Chat panel (right in 2.x, hidden in 3.0) */}
        <div
          style={{
            width: `${chatWidth}%`,
            backgroundColor: C.bgAlt,
            padding: chatWidth > 5 ? 20 : 0,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {chatWidth > 5 && (
            <>
              <div
                style={{
                  alignSelf: "flex-end",
                  padding: "8px 14px",
                  borderRadius: 12,
                  backgroundColor: `${C.accent}20`,
                  maxWidth: "80%",
                }}
              >
                <div style={{ width: 100, height: 8, borderRadius: 4, backgroundColor: `${C.dark}15` }} />
              </div>
              <div
                style={{
                  alignSelf: "flex-start",
                  padding: "8px 14px",
                  borderRadius: 12,
                  backgroundColor: `${C.dark}08`,
                  maxWidth: "80%",
                }}
              >
                <div style={{ width: 120, height: 8, borderRadius: 4, backgroundColor: `${C.dark}12` }} />
                <div style={{ width: 80, height: 8, borderRadius: 4, backgroundColor: `${C.dark}08`, marginTop: 6 }} />
              </div>
              <div
                style={{
                  alignSelf: "flex-end",
                  padding: "8px 14px",
                  borderRadius: 12,
                  backgroundColor: `${C.accent}20`,
                  maxWidth: "80%",
                }}
              >
                <div style={{ width: 90, height: 8, borderRadius: 4, backgroundColor: `${C.dark}15` }} />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Bottom title */}
      <div
        style={{
          position: "absolute",
          left: 80,
          bottom: 60,
          ...titleAnim,
        }}
      >
        <div style={{ fontFamily: SERIF, fontSize: 36, fontWeight: 700, color: C.dark }}>
          From editor <span style={{ color: C.accent }}>→</span> AI-native micro-apps
        </div>
        <div style={{ fontFamily: SANS, fontSize: 16, color: C.textLight, marginTop: 8 }}>
          Users interact with the app, not the chat. Agent is a floating assistant.
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ═══════════════════════════════════════════════════════════
// Scene 8: Close (42–45s, 90 frames)
// ═══════════════════════════════════════════════════════════
const Close: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const markSpring = spring({ frame: frame - 4, fps, config: { damping: 200, stiffness: 100 } });
  const lineW = interpolate(frame, [0.3 * fps, 1.0 * fps], [0, 140], { ...CL, easing: expoOut });
  const title = fadeIn(frame, 0.5 * fps, 0.5 * fps, 25);
  const url = fadeIn(frame, 1.0 * fps, 0.5 * fps, 20);

  return (
    <AbsoluteFill style={{ backgroundColor: C.bg, justifyContent: "center", alignItems: "center" }}>
      <div style={{ textAlign: "center" }}>
        {/* Pneuma logo */}
        <Img
          src={staticFile("pneuma-logo.png")}
          style={{
            width: 110,
            height: "auto",
            margin: "0 auto 24px",
            opacity: markSpring,
            transform: `scale(${0.7 + 0.3 * markSpring})`,
            objectFit: "contain",
          }}
        />

        {/* Accent line */}
        <div style={{ width: lineW, height: 3, backgroundColor: C.accent, margin: "0 auto 36px" }} />

        {/* Title */}
        <div
          style={{
            fontFamily: SERIF,
            fontSize: 46,
            fontWeight: 700,
            color: C.dark,
            lineHeight: 1.3,
            ...title,
          }}
        >
          Open Source. MIT License.
        </div>
        <div
          style={{
            fontFamily: SANS,
            fontSize: 20,
            color: C.textLight,
            marginTop: 16,
            ...title,
          }}
        >
          Join the co-creation.
        </div>

        {/* URL */}
        <div
          style={{
            fontFamily: SANS,
            fontSize: 20,
            fontWeight: 500,
            color: C.accent,
            marginTop: 36,
            letterSpacing: "0.03em",
            ...url,
          }}
        >
          github.com/pandazki/pneuma-skills
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ═══════════════════════════════════════════════════════════
// Main Composition
// ═══════════════════════════════════════════════════════════
export const PneumaSkills: React.FC = () => {
  useFonts();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill style={{ backgroundColor: C.bg }}>
      <Sequence from={0} durationInFrames={4 * fps}>
        <Opening />
      </Sequence>
      <Sequence from={4 * fps} durationInFrames={5 * fps}>
        <TheGap />
      </Sequence>
      <Sequence from={9 * fps} durationInFrames={7 * fps}>
        <TheProtocol />
      </Sequence>
      <Sequence from={16 * fps} durationInFrames={6 * fps}>
        <LiveFlow />
      </Sequence>
      <Sequence from={22 * fps} durationInFrames={8 * fps}>
        <FourPillars />
      </Sequence>
      <Sequence from={30 * fps} durationInFrames={8 * fps}>
        <ModesScene />
      </Sequence>
      <Sequence from={38 * fps} durationInFrames={4 * fps}>
        <Vision />
      </Sequence>
      <Sequence from={42 * fps} durationInFrames={3 * fps}>
        <Close />
      </Sequence>
    </AbsoluteFill>
  );
};
