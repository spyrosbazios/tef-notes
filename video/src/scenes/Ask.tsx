import { ASK, AskDock, DOCK, TURN } from "@/components/mock/WebAsk";
import { Peek } from "@/components/ui";
import { useClock } from "../kit/clock";
import { Arrive, Enter, Tap } from "../kit/moves";
import { Split } from "../kit/Scene";
import type { Shot } from "../storyboard";

/** The dock a little taller than the site draws it, so the turn's last line clears the composer. */
const TALL = { w: DOCK.w, h: 700 };

/** When the question is sent, and when each piece of the turn after it arrives: the steps, the answer, the card, its last line. */
const SEND = 2.2, PIECES = [SEND, 2.6, 3, 3.7, 3.95], APPROVE = 5;

/** The assistant's dock: a question is typed and sent, the turn arrives a piece at a time, and the card it proposes is approved. */
export function Ask({ shot }: { shot: Shot }) {
  const { typed, after } = useClock();
  return (
    <Split shot={shot}>
      <Enter top={24}>
        <Peek label="The assistant's dock beside a note" size={TALL} className="w-[590px]">
          <AskDock draft={after(SEND) ? undefined : typed(ASK, 0.6)} turn={TURN.map((piece, i) => <Arrive key={i} at={PIECES[i] ?? SEND}>{piece}</Arrive>)} />
        </Peek>
      </Enter>
      <Tap on="send" at={SEND} />
      <Tap on="approve" at={APPROVE} />
    </Split>
  );
}
