// The app bar's notice: a thin strip while the server can't be reached (hooks/online.ts), and while changes made here wait to be sent
// (hooks/sync.ts). Reads still work from the local copy (lib/local.ts) and edits are kept in it, to go up when the server is back.
import { blur, transition, useTempoTransition } from "@animate-ui/react/utils/motion";
import { CloudUpload, WifiOff } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { Swap } from "@/components/swap";
import { useOnline } from "@/hooks/online";
import { useSyncStatus } from "@/hooks/sync";

/** How long changes must have waited while online before the strip says so: an edit is sent 1.5 s after the last, and the strip
 *  would otherwise flash on every keystroke's save. */
const SETTLE = 4000;

const changes = (n: number) => `${n} ${n === 1 ? "change" : "changes"} waiting`;

/** The strip unfolds to push the page down instead of popping in (Animate UI's banner: the one place height animates, because what is
 *  below must move), and a count changing swaps in place. Not on first render: a page that opens offline opens with it. */
export function OfflineBar() {
  const online = useOnline(), { waiting } = useSyncStatus();
  const unfold = useTempoTransition(transition.disclosure);
  const [lateFor, setLateFor] = useState(0);                 // the count that has waited SETTLE already
  useEffect(() => {
    if (!waiting) return;
    const t = setTimeout(() => setLateFor(waiting), SETTLE);
    return () => clearTimeout(t);
  }, [waiting]);
  const show = !online || (waiting > 0 && lateFor === waiting);
  const count = <Swap id={waiting}>{changes(waiting)}</Swap>;
  return (
    <AnimatePresence initial={false}>
      {show ? (
        <motion.div key="bar" role="status" className="shrink-0 overflow-hidden" transition={unfold}
          initial={{ height: 0, opacity: 0, filter: blur.disclosure }} animate={{ height: "auto", opacity: 1, filter: "blur(0px)" }}
          exit={{ height: 0, opacity: 0, filter: blur.disclosure }}>
          <div className="flex items-center justify-center gap-1.5 border-b border-line bg-raised px-3 py-1 text-xs text-dim">
            {online ? <CloudUpload className="size-3.5" /> : <WifiOff className="size-3.5" />}
            {online ? count : <>Offline: showing what was last synced{waiting ? <> · {count}</> : ""}</>}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
