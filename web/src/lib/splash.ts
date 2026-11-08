// The boot layer (vite-boot.ts: the chosen theme's ground, painted before any script of ours ran) goes once the router has
// rendered its first screen: it fades over the screen (index.html's `[data-done]` rule), then the element is gone.
// A cap takes it away regardless, so a screen that never renders (a loader waiting on the first sync) never hides behind it.
import { calm } from "@/hooks/media";
import { SPLASH_ID } from "./boot";

const CAP_MS = 3000;
/** The fade's length, vite-boot.ts's `transition.reveal`: when it ends the element is removed. */
const FADE_MS = 300;

export function splashUntilRendered(router: { subscribe(type: "onRendered", fn: () => void): () => void }) {
  const el = document.getElementById(SPLASH_ID);
  if (!el) return;
  let unsub = () => {};
  const drop = () => {
    unsub();
    clearTimeout(cap);
    // Two frames on: the screen under it has painted before the fade starts, so nothing shows through half-drawn
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.dataset.done = "";
      setTimeout(() => el.remove(), calm() ? 0 : FADE_MS);
    }));
  };
  const cap = setTimeout(drop, CAP_MS);
  unsub = router.subscribe("onRendered", drop);
}
