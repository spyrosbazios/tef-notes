import { CLIP, ClipperPopup, NOTE } from "@/components/mock/Clipper";
import { Peek } from "@/components/ui";
import { useClock } from "../kit/clock";
import { Enter, Tap } from "../kit/moves";
import { Split } from "../kit/Scene";
import { SIZE, type Shot } from "../storyboard";

/** The popup's width in the frame, and with it its height: taller than the frame, so the scene pans down it. */
const WIDTH = 640, HEIGHT = (WIDTH / CLIP.w) * CLIP.h, EDGE = 48;

/** The clipper over a page, from its top: the owner's note is typed as the frame moves down to where it can be saved, then
 *  the first place it offers, the one it thinks likeliest, is pressed. */
export function Clip({ shot }: { shot: Shot }) {
  const { typed, ramp } = useClock();
  const foot = SIZE.height - EDGE - HEIGHT;
  return (
    <Split shot={shot}>
      <Enter top={EDGE + (foot - EDGE) * ramp(1.2, 1.3)}>
        <Peek label="The clipper's popup over a page" size={CLIP} className="w-[640px]"><ClipperPopup note={typed(NOTE, 1.1)} /></Peek>
      </Enter>
      <Tap on="save 0" at={3.5} />
    </Split>
  );
}
