import type { CSSProperties } from "react";
import { PhoneHome } from "@/components/mock/PhoneHome";
import { WebHome } from "@/components/mock/WebHome";
import { BrowserFrame, PhoneFrame } from "@/components/ui";

/** Home on both its screens, as the site's hero pairs them: the web app in a browser, the installed app's phone over its
 *  corner. `browser` and `phone` are each one's own style, for a scene that brings them on apart. */
export function Pair({ browser, phone }: { browser?: CSSProperties; phone?: CSSProperties }) {
  return (
    <div className="relative mx-auto w-[1480px]">
      <div style={browser}><BrowserFrame label="Home on the web"><WebHome /></BrowserFrame></div>
      <PhoneFrame label="Home on the phone" className="absolute -right-[70px] top-[130px] w-[310px]" style={phone}><PhoneHome /></PhoneFrame>
    </div>
  );
}
