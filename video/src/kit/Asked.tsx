import { AskDock, DOCK } from "@/components/mock/WebAsk";
import type { Turn } from "@/components/mock/Turns";
import { Peek } from "@/components/ui";
import type { Shot } from "../storyboard";
import { useClock } from "./clock";
import { Arrive, Enter, Tap } from "./moves";
import { Split } from "./Scene";

/** The dock a little taller than the site draws it: more of a reply shows before the chat runs up under its header. */
const TALL = { w: DOCK.w, h: 720 };
/** The space the dock keeps between a turn's pieces (its gap-4). */
const GAP = 16;

/** A turn with the assistant, played in its dock: the question is typed into the composer and sent at `send`, its bubble
 *  appears, and each piece of the reply arrives at its own time (`arrive`, one for each piece after the bubble). A scene
 *  about the assistant is this, a turn (site/src/components/mock/Turns.tsx) and its times. */
export function Asked({ shot, turn, send, arrive, label }: { shot: Shot; turn: Turn; send: number; arrive: number[]; label: string }) {
  const { typed, after } = useClock();
  return (
    <Split shot={shot}>
      <Enter top={18}>
        <Peek label={label} size={TALL} className="w-[580px]">
          <AskDock sees={turn.sees} draft={after(send) ? undefined : typed(turn.ask, 0.4, 34)}
            turn={turn.pieces.map((piece, i) => <Arrive key={i} at={i ? arrive[i - 1] ?? send : send} gap={i ? GAP : 0}>{piece}</Arrive>)} />
        </Peek>
      </Enter>
      <Tap on="send" at={send} />
    </Split>
  );
}
