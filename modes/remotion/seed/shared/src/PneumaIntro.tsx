// PneumaIntro — ~63s product intro for Pneuma Skills.
// Direction: warm editorial paper. Brand terracotta + sage on tinted cream, dark warm-brown
// panels for the agent side, serif display type, mono for the engineering layer.
// Beat: etymology → the gap → HERO (one file, two views) → four pillars → the mode catalog
// piles up (physics) → convergence + sign-off.
// Copy and text faces come from locale.ts; everything else is language-neutral.
import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { C, FontGate, Grain, HANDOFF } from "./theme";
import { Opening, OPENING_DUR } from "./SceneOpening";
import { Gap, GAP_DUR } from "./SceneGap";
import { Loop, LOOP_DUR } from "./SceneLoop";
import { Pillars, PILLARS_DUR } from "./ScenePillars";
import { Modes, MODES_DUR } from "./SceneModes";
import { Finale, FINALE_DUR } from "./SceneFinale";

// Every scene starts HANDOFF frames before the previous one ends; inside that window the
// outgoing words leave, the incoming subject arrives, then the outgoing subject leaves
// (see "Scene handoffs" in theme.tsx). The frame always has a picture on it.
const SCENES = [
  { C: Opening, d: OPENING_DUR, overlap: 0 },
  { C: Gap, d: GAP_DUR, overlap: HANDOFF },
  { C: Loop, d: LOOP_DUR, overlap: HANDOFF },
  { C: Pillars, d: PILLARS_DUR, overlap: HANDOFF },
  { C: Modes, d: MODES_DUR, overlap: HANDOFF },
  { C: Finale, d: FINALE_DUR, overlap: HANDOFF },
];

const PNEUMA_INTRO_DUR = SCENES.reduce((s, x) => s + x.d - x.overlap, 0);

const PneumaIntro: React.FC = () => {
  let from = 0;
  return (
    <AbsoluteFill style={{ background: C.paper }}>
      <FontGate>
        {SCENES.map(({ C: Scene, d, overlap }, i) => {
          from -= overlap;
          const el = (
            <Sequence key={i} from={from} durationInFrames={d}>
              <Scene />
            </Sequence>
          );
          from += d;
          return el;
        })}
      </FontGate>
      <Grain />
    </AbsoluteFill>
  );
};

// The preview compiler rewrites `export const` without keeping a local binding,
// so exports are declared as locals and listed here.
export { PNEUMA_INTRO_DUR, PneumaIntro };
