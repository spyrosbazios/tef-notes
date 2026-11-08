// The app bar's notice: a thin strip while the server can't be reached (hooks/online.ts), and while changes made here wait to be sent
// (hooks/sync.ts). Reads still work from the local copy (lib/local.ts) and edits are kept in it, to go up when the server is back.
import { CloudUpload, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { useOnline } from "@/hooks/online";
import { useSyncStatus } from "@/hooks/sync";

/** How long changes must have waited while online before the strip says so: an edit is sent 1.5 s after the last, and the strip
 *  would otherwise flash on every keystroke's save. */
const SETTLE = 4000;

const changes = (n: number) => `${n} ${n === 1 ? "change" : "changes"} waiting`;

export function OfflineBar() {
  const online = useOnline(), { waiting } = useSyncStatus();
  const [lateFor, setLateFor] = useState(0);                 // the count that has waited SETTLE already
  useEffect(() => {
    if (!waiting) return;
    const t = setTimeout(() => setLateFor(waiting), SETTLE);
    return () => clearTimeout(t);
  }, [waiting]);
  if (online && !(waiting && lateFor === waiting)) return null;
  return (
    <div role="status" className="flex shrink-0 items-center justify-center gap-1.5 border-b border-line bg-raised px-3 py-1 text-xs text-dim">
      {online ? <CloudUpload className="size-3.5" /> : <WifiOff className="size-3.5" />}
      {online ? changes(waiting) : <>Offline: showing what was last synced{waiting ? ` · ${changes(waiting)}` : ""}</>}
    </div>
  );
}
