import { Composition } from "remotion";
import { PneumaIntro } from "./PneumaIntro";

// durationInFrames must stay a literal (the live preview reads it from this file):
// it equals PNEUMA_INTRO_DUR in PneumaIntro.tsx — scene durations minus crossfade overlaps.
export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="PneumaIntro"
      component={PneumaIntro}
      durationInFrames={1884}
      fps={30}
      width={1280}
      height={720}
    />
  </>
);
