// What the sync has to say (lib/sync.ts): how many changes wait to be sent, which notes are in conflict, whether a sync is out.
import { useSyncExternalStore } from "react";
import { getStatus, watchStatus, type SyncStatus } from "@/lib/sync";

export const useSyncStatus = (): SyncStatus => useSyncExternalStore(watchStatus, getStatus);
