// The app's notice of its connection: a small pill floating over the top of the page while the server can't be reached
// (hooks/online.ts), and while changes made here could not be sent (hooks/sync.ts). It lies over the page and takes no room, so
// nothing moves when it comes or goes. Reads still work from the local copy (lib/local.ts) and edits are kept in it, to go up when
// the server is back.
import { blur, transition, useTempoTransition } from "@animate-ui/react/utils/motion";
import { CloudUpload, WifiOff } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { Swap } from "@/components/swap";
import { useOnline } from "@/hooks/online";
import { useSyncStatus } from "@/hooks/sync";

/** How long the server must have been out of reach before the pill says so: one failed request or the realtime stream dropping
 *  (every return from the background) marks it unreachable until the next answer, a second or two later. */
const GRACE = 3000;

const changes = (n: number) => `${n} ${n === 1 ? "change" : "changes"} waiting`;

/** `on`, once it has stayed so for `ms`; off at once. */
function useHeld(on: boolean, ms: number): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!on) return;
    const t = setTimeout(() => setHeld(true), ms);
    return () => { clearTimeout(t); setHeld(false); };
  }, [on, ms]);
  return on && held;
}

/** Offline that has lasted, or changes the last sync failed to send. Changes only waiting their turn (an edit goes up a moment after
 *  the last, lib/sync.ts) are not news, nor is a conflict, which Settings lists. A count changing swaps in place. */
export function SyncNotice() {
  const online = useOnline(), { waiting, error } = useSyncStatus();
  const appear = useTempoTransition(transition.disclosure);
  const offline = useHeld(!online, GRACE), stuck = online && waiting > 0 && !!error;
  const count = <Swap id={waiting}>{changes(waiting)}</Swap>;
  return (
    <AnimatePresence>
      {offline || stuck ? (
        <motion.div key="notice" role="status" transition={appear}
          className="pointer-events-none absolute inset-x-0 top-2 z-40 flex justify-center px-3"
          initial={{ opacity: 0, filter: blur.disclosure }} animate={{ opacity: 1, filter: "blur(0px)" }} exit={{ opacity: 0, filter: blur.disclosure }}>
          <div className="flex items-center gap-1.5 rounded-full border border-line bg-raised px-3 py-1 text-xs text-dim shadow-sm">
            {offline ? <WifiOff className="size-3.5" /> : <CloudUpload className="size-3.5" />}
            {offline ? <>Offline{waiting ? <> · {count}</> : ""}</> : count}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
