import { Composition } from "remotion";
import { LauncherOverview } from "./Composition";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="LauncherOverview"
        component={LauncherOverview}
        durationInFrames={600}
        fps={24}
        width={1920}
        height={1080}
      />
    </>
  );
};
