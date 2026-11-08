// Whether the app can reach its server right now (lib/net.ts): false offline, and while the server isn't answering.
import { useSyncExternalStore } from "react";
import { getNet, isOffline, subscribe } from "@/lib/net";

export const useOnline = (): boolean => !useSyncExternalStore(subscribe, () => isOffline(getNet()));
