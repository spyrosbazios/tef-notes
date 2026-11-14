import { Composition } from "remotion";
import { DEFAULT_THEME } from "@/core/theme";
import { Film } from "./Film";
import { FPS, frames, SIZE, timeline } from "./storyboard";

/** The one composition: the film, as long as the storyboard makes it, in the app's default theme unless a render names another. */
export function Root() {
  const length = timeline().reduce((sum, segment) => sum + frames(segment.seconds), 0);
  return <Composition id="Film" component={Film} durationInFrames={length} fps={FPS} {...SIZE} defaultProps={{ theme: DEFAULT_THEME }} />;
}
