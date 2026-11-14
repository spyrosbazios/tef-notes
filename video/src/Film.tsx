import { Series } from "remotion";
import { THEMES, type ThemeName } from "@/core/theme";
import { Stage } from "./kit/Stage";
import { Closing } from "./scenes/Closing";
import { SCENES } from "./scenes";
import { Opening } from "./scenes/Opening";
import { CLOSING, frames, OPENING, STORYBOARD } from "./storyboard";

/** What a render can choose: the theme the whole film wears. */
export type FilmProps = { theme: ThemeName };

/** The film: one stage, and on it the opening, the storyboard's shots in order, and the closing. */
export function Film({ theme }: FilmProps) {
  return (
    <Stage theme={THEMES[theme]}>
      <Series>
        <Series.Sequence durationInFrames={frames(OPENING.seconds)}><Opening /></Series.Sequence>
        {STORYBOARD.map((shot) => {
          const Scene = SCENES[shot.scene];
          return <Series.Sequence key={shot.scene} durationInFrames={frames(shot.seconds)}><Scene shot={shot} /></Series.Sequence>;
        })}
        <Series.Sequence durationInFrames={frames(CLOSING.seconds)}><Closing /></Series.Sequence>
      </Series>
    </Stage>
  );
}
