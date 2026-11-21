// What the sync has to say (lib/sync.ts): how many changes wait to be sent, which notes are in conflict, whether a sync is out;
// and what a screen asks of it: a sync now, a refused change sent again or let go.
import { useSyncExternalStore } from "react";
import { getStatus, watchStatus, type SyncStatus } from "@/lib/records";

export const useSyncStatus = (): SyncStatus => useSyncExternalStore(watchStatus, getStatus);

export { resolveRefused, syncNow } from "@/lib/records";
