// The app's notice of its connection: a small pill floating over the top of the page while the server can't be reached
// (hooks/online.ts), and while changes made here could not be sent (hooks/sync.ts). It lies over the page and takes no room, so
// nothing moves when it comes or goes. Reads still work from the local copy (lib/local.ts) and edits are kept in it, to go up when
// the server is back.
import { blur, transition, useTempoTransition } from "@animate-ui/react/utils/motion";
import { CloudAlert, CloudUpload, HardDrive, WifiOff } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Swap } from "@/components/swap";
import { useConnection } from "@/hooks/sync";

const changes = (n: number) => `${n} ${n === 1 ? "change" : "changes"} waiting`;

/** Offline that has lasted, changes the last sync failed to send, changes the server refused (Settings lists them, to send
 *  again or let go), or the copy failing to be written to this device (edits would not outlive the page). Changes only waiting their turn (an edit goes up a moment after the last, lib/sync.ts) are not news, nor is
 *  a conflict, which Settings lists. A count changing swaps in place. */
export function SyncNotice() {
  const { state, waiting, refused } = useConnection();
  const appear = useTempoTransition(transition.disclosure);
  const offline = state === "offline", stuck = state === "stuck", refusedOnly = state === "refused", notKept = state === "notKept";
  const count = <Swap id={waiting}>{changes(waiting)}</Swap>;
  const refusals = <Swap id={`r${refused}`}>{`${refused} ${refused === 1 ? "change" : "changes"} refused · see Settings`}</Swap>;
  return (
    <AnimatePresence>
      {offline || stuck || refusedOnly || notKept ? (
        <motion.div key="notice" role="status" transition={appear}
          className="pointer-events-none absolute inset-x-0 top-2 z-40 flex justify-center px-3"
          initial={{ opacity: 0, filter: blur.disclosure }} animate={{ opacity: 1, filter: "blur(0px)" }} exit={{ opacity: 0, filter: blur.disclosure }}>
          <div className="flex items-center gap-1.5 rounded-full border border-line bg-raised px-3 py-1 text-xs text-dim shadow-sm">
            {offline ? <WifiOff className="size-3.5" /> : refusedOnly ? <CloudAlert className="size-3.5" /> : notKept ? <HardDrive className="size-3.5" /> : <CloudUpload className="size-3.5" />}
            {offline ? <>Offline{waiting ? <> · {count}</> : ""}</> : refusedOnly ? refusals : notKept ? "Not saved on this device" : count}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
