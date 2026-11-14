import { PhoneHome } from "@/components/mock/PhoneHome";
import { PhoneFrame, scoped } from "@/components/ui";
import { withAccent } from "@/core/theme";
import { useClock } from "../kit/clock";
import { Enter, Tap } from "../kit/moves";
import { Split } from "../kit/Scene";
import { useTheme } from "../kit/Stage";
import type { Shot } from "../storyboard";

const SWITCH = 1.7;

/** Home on the phone through the Home lens; the lens is pressed, and the same screen shows only Work, in Work's own colour
 *  (teal, as the site's lens tile has it). */
export function Lens({ shot }: { shot: Shot }) {
  const work = useClock().ramp(SWITCH + 0.1, 0.5);
  const theme = useTheme();
  return (
    <Split shot={shot}>
      <Enter top={70}>
        <PhoneFrame label="Home on the phone, through a lens" className="w-[600px]">
          <div className="relative h-full w-full">
            <PhoneHome lens="Home" />
            <div className="absolute inset-0 text-fg" style={{ ...scoped(withAccent(theme, "teal")), opacity: work }}><PhoneHome lens="Work" /></div>
          </div>
        </PhoneFrame>
      </Enter>
      <Tap on="lens" at={SWITCH} />
    </Split>
  );
}
