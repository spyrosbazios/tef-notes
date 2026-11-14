import { ClipperPage, NOTE, PAGE } from "@/components/mock/Clipper";
import { Peek } from "@/components/ui";
import { useClock } from "../kit/clock";
import { Enter, Tap } from "../kit/moves";
import { Split } from "../kit/Scene";
import type { Shot } from "../storyboard";

/** When the clipper's mark is pressed in Chrome's toolbar, and when the place the popup offers first is. */
const OPEN = 1, SAVE = 4.1;

/** A page open in Chrome: the clipper's mark in the toolbar is pressed, its popup opens over the page, the owner's note is
 *  typed, and the first place it offers, the one it thinks likeliest, is pressed. */
export function Clip({ shot }: { shot: Shot }) {
  const { typed, ramp } = useClock();
  return (
    <Split shot={shot}>
      <Enter top={44}>
        <Peek label="A page in Chrome with the clipper's popup open over it" size={PAGE} className="w-[900px]">
          <ClipperPage open={ramp(OPEN, 0.3)} note={typed(NOTE, 1.8)} />
        </Peek>
      </Enter>
      <Tap on="clip" at={OPEN} />
      <Tap on="save 0" at={SAVE} />
    </Split>
  );
}
