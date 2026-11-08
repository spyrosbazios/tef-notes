// What a screen shows while the router waits for its data past `defaultPendingMs` (router.ts): only a cold start's first sync
// gets this far, as every later load reads the local copy.
import { Loader2 } from "lucide-react";

export function Pending() {
  return (
    <div className="grid h-full place-items-center" role="status" aria-label="Loading">
      <Loader2 className="size-5 animate-spin text-faint" />
    </div>
  );
}
