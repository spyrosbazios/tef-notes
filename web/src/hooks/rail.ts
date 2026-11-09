// The desktop rail as this browser keeps it: folded to its icons or open. The state of this window, not a preference
// (core/prefs.ts says why): kept here alone. `[` toggles it (shell.tsx), as does the rail's own last button.
import { STORAGE } from "@/lib/storage-keys";
import { persisted } from "./store";

const rail = persisted<{ folded: boolean }>(STORAGE.rail, (p) => ({ folded: p.folded === true }));

export const useRail = rail.use;
export const toggleRail = () => rail.set({ folded: !rail.read().folded });
