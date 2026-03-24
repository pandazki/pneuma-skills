import { Composition } from "remotion";
import { PneumaIntro } from "./PneumaIntro";

export const RemotionRoot: React.FC = () => {
  // PneumaIntro: 5.5+5+7+6+6+6+6+11+7.5 = 60s = 1800 frames
  return (
    <>
      <Composition
        id="PneumaIntro"
        component={PneumaIntro}
        durationInFrames={1800}
        fps={30}
        width={1280}
        height={720}
      />
    </>
  );
};
