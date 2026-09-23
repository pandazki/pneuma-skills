// Pneuma brand tokens — sampled from public/ assets (pneuma-mark.png paper + terracotta).
// Direction: editorial / warm paper. Serif display, mono for the "engineering" layer,
// dark warm-brown panels for anything that is agent-side (files, tool calls).
// Copy, the text faces and per-language size tweaks live in locale.ts.
import React, { useEffect, useState } from "react";
import {
  AbsoluteFill,
  Easing,
  cancelRender,
  continueRender,
  delayRender,
  getRemotionEnvironment,
  interpolate,
  useBufferState,
} from "remotion";
import { FONT, T } from "./locale";

const C = {
  paper: "#f2eadc",
  paperDeep: "#e8dcc7",
  card: "#faf5eb",
  ink: "#2a211c",
  ink2: "#5a4a3f",
  muted: "#968574",
  terra: "#ba5334",
  terraSoft: "#d9896a",
  sage: "#7b9a80",
  sageSoft: "#a9c1ab",
  night: "#2b2320",
  night2: "#362c28",
  nightLine: "rgba(242,234,220,0.10)",
  nightText: "#e9dfcd",
  nightMuted: "#9c8b7b",
  line: "rgba(42,33,28,0.16)",
};

const F = {
  /** Latin display serif (brand, numerals, the wordmark). */
  display: "'Fraunces', 'Iowan Old Style', Georgia, serif",
  /** The Greek word in the opening — Fraunces has no Greek. */
  greek: "'EB Garamond', 'Fraunces', Georgia, serif",
  /** Headlines and captions in the video's language. */
  head: FONT.head,
  /** Paragraphs, labels inside mock UIs, diagram captions. */
  body: FONT.body,
  mono: `'JetBrains Mono', ${FONT.monoFallback}, 'SF Mono', Menlo, monospace`,
};

// ---- Fonts ------------------------------------------------------------------------
// Every face is fetched from a CDN at render time (nothing is bundled). The gate below
// holds the frame until the faces the video actually uses are loaded, so no frame is
// ever captured with a fallback font — in `remotion render` (delayRender) and in the
// live Player (buffering + a blank paper frame until ready).

const LATIN_CSS =
  "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..600;1,9..144,300..600" +
  "&family=JetBrains+Mono:wght@400;500&family=EB+Garamond:ital,wght@1,400&display=swap";

const LATIN_FACES = [
  "300 1em Fraunces",
  "400 1em Fraunces",
  "500 1em Fraunces",
  "italic 300 1em Fraunces",
  "italic 400 1em Fraunces",
  "400 1em 'JetBrains Mono'",
  "500 1em 'JetBrains Mono'",
  "italic 400 1em 'EB Garamond'",
];

/** Every character the video can draw, so unicode-range subsets (CJK) load exactly what is used. */
const collectText = (v: unknown): string =>
  typeof v === "string" ? v : Array.isArray(v) ? v.map(collectText).join("") : v && typeof v === "object" ? Object.values(v).map(collectText).join("") : "";

const SAMPLE_TEXT = (() => {
  const all = collectText(T) + "πνεῦμα Pneuma Skills 0123456789 ·—–<>/[]{}()+−=:;.,!?'\"@#&%«»“”‘’";
  return Array.from(new Set(Array.from(all))).join("");
})();

const loadStylesheet = (href: string) =>
  new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLLinkElement>(`link[data-pn-font="${href}"]`);
    if (existing?.sheet) return resolve();
    const link = existing ?? document.createElement("link");
    link.addEventListener("load", () => resolve(), { once: true });
    link.addEventListener(
      "error",
      () => {
        link.remove(); // let a retry start from a fresh <link>
        reject(new Error(`Font stylesheet failed to load: ${href}`));
      },
      { once: true },
    );
    if (!existing) {
      link.rel = "stylesheet";
      link.href = href;
      link.dataset.pnFont = href;
      document.head.appendChild(link);
    }
  });

let fontsReady = false;
let fontsPromise: Promise<void> | null = null;

const loadFonts = () => {
  if (!fontsPromise) {
    fontsPromise = (async () => {
      await Promise.all([LATIN_CSS, ...FONT.css].map(loadStylesheet));
      const faces = [...LATIN_FACES, ...FONT.faces];
      const loaded = await Promise.all(faces.map((spec) => document.fonts.load(spec, SAMPLE_TEXT)));
      const missing = faces.filter((_, i) => loaded[i].length === 0);
      if (missing.length > 0) throw new Error(`Fonts did not resolve: ${missing.join(", ")}`);
      fontsReady = true;
    })();
    // A failed attempt must not be cached forever: the next mount retries.
    fontsPromise.catch(() => {
      fontsPromise = null;
    });
  }
  return fontsPromise;
};

/** Renders children only once every face is loaded. */
const FontGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [ready, setReady] = useState(fontsReady);
  const [handle] = useState(() => (fontsReady ? null : delayRender("Loading fonts")));
  const buffer = useBufferState();

  useEffect(() => {
    if (ready) return;
    const pause = buffer.delayPlayback();
    let alive = true;
    loadFonts()
      .then(() => {
        if (!alive) return;
        setReady(true);
        if (handle !== null) continueRender(handle);
      })
      .catch((err: Error) => {
        if (getRemotionEnvironment().isRendering) {
          // A render with fallback fonts would look finished and be wrong — fail loudly.
          cancelRender(err);
          return;
        }
        // Live preview (e.g. offline): say so, then show the fallback rather than nothing.
        console.error(`[fonts] ${err.message} — preview continues with fallback fonts.`);
        if (!alive) return;
        setReady(true);
        if (handle !== null) continueRender(handle);
      })
      .finally(() => pause.unblock());
    return () => {
      alive = false;
      pause.unblock();
    };
  }, [ready, handle, buffer]);

  return ready ? <>{children}</> : null;
};

// ---- Motion helpers ---------------------------------------------------------------

const expoOut = Easing.out(Easing.exp);
const expoInOut = Easing.inOut(Easing.exp);
const quadOut = Easing.out(Easing.quad);

/** Clamped tween from `from` to `to` between frames a..b. */
const tw = (
  f: number,
  a: number,
  b: number,
  from = 0,
  to = 1,
  easing: (t: number) => number = expoOut,
) =>
  interpolate(f, [a, b], [from, to], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing,
  });

// ---- Scene handoffs ----------------------------------------------------------------
// Each scene starts HANDOFF frames before the previous one ends. Within that window the
// order is fixed, so the frame never goes empty and two texts never double-expose:
//   1. outgoing text leaves       [dur − HANDOFF − 10, dur − HANDOFF]  (before the next scene starts)
//   2. incoming subject arrives    next scene's local 0 … ~12           (image / panels / tiles)
//   3. outgoing subject leaves     [dur − 12, dur]                       (once the new subject is up)
//   4. incoming text arrives       next scene's local ≥ TEXT_IN          (over paper, not over text)

const HANDOFF = 20;
const TEXT_IN = 16;

/** Outgoing text layer: gone before the next scene begins. */
const exitText = (f: number, dur: number) => tw(f, dur - HANDOFF - 10, dur - HANDOFF, 1, 0, Easing.in(Easing.quad));

/** Outgoing subject layer: stays until the next scene's subject is visible. */
const exitSubject = (f: number, dur: number) => tw(f, dur - 12, dur, 1, 0, Easing.in(Easing.quad));

/** Static paper grain + soft vignette, laid over every scene. */
const Grain: React.FC = () => (
  <AbsoluteFill style={{ pointerEvents: "none" }}>
    <svg width="100%" height="100%" style={{ position: "absolute", inset: 0, mixBlendMode: "multiply", opacity: 0.18 }}>
      <filter id="pn-grain">
        <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch" />
        <feColorMatrix type="saturate" values="0" />
      </filter>
      <rect width="100%" height="100%" filter="url(#pn-grain)" />
    </svg>
    <AbsoluteFill
      style={{
        background: "radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 55%, rgba(80,52,30,0.16) 100%)",
      }}
    />
  </AbsoluteFill>
);

/** Small uppercase mono label used as a section marker. */
const Label: React.FC<{ children: React.ReactNode; color?: string; style?: React.CSSProperties }> = ({
  children,
  color = C.muted,
  style,
}) => (
  <div
    style={{
      fontFamily: F.mono,
      fontSize: 13,
      letterSpacing: 2.4,
      textTransform: "uppercase",
      color,
      ...style,
    }}
  >
    {children}
  </div>
);

// The preview compiler rewrites `export const` without keeping a local binding,
// so exports are declared as locals and listed here.
export { C, F, expoOut, expoInOut, quadOut, tw, HANDOFF, TEXT_IN, exitText, exitSubject, FontGate, Grain, Label };
