import { Composition } from "remotion";
import { PneumaSkills } from "./PneumaSkills";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="PneumaSkills"
        component={PneumaSkills}
        durationInFrames={1350}
        fps={30}
        width={{{compositionWidth}}}
        height={{{compositionHeight}}}
      />
    </>
  );
};
