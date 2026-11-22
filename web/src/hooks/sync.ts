// What the sync has to say (lib/sync.ts): how many changes wait to be sent, which notes are in conflict, whether a sync is out;
// and what a screen asks of it: a sync now, a refused change sent again or let go.
import { useEffect, useState, useSyncExternalStore } from "react";
import { useOnline } from "@/hooks/online";
import { getStatus, watchStatus, type SyncStatus } from "@/lib/records";

export const useSyncStatus = (): SyncStatus => useSyncExternalStore(watchStatus, getStatus);

/** How long the server must have been out of reach before it counts as offline: one failed request or the realtime stream
 *  dropping (every return from the background) marks it unreachable until the next answer, a second or two later. */
const GRACE = 3000;

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

/** The connection as news, the one thing worth saying, most pressing first: offline that has lasted, changes the last sync
 *  failed to send (`stuck`), changes the server refused (Settings lists them), the copy failing to be written to this device
 *  (`notKept`), changes on their way up (`sending`: only waiting their turn, not news for the app-wide notice), or none. */
export type Connection = "offline" | "stuck" | "refused" | "notKept" | "sending" | null;

export function useConnection(): { state: Connection; waiting: number; refused: number } {
  const online = useOnline(), { waiting, error, refused, unsaved } = useSyncStatus();
  const offline = useHeld(!online, GRACE);
  const state: Connection = offline ? "offline" : !online ? null : waiting > 0 && error ? "stuck" : refused.length ? "refused"
    : unsaved ? "notKept" : waiting > 0 ? "sending" : null;
  return { state, waiting, refused: refused.length };
}

export { resolveRefused, syncNow } from "@/lib/records";
