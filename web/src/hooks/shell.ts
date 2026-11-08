// What the shell (components/shell.tsx) lends the screens the router puts in it (routes/_app/): its "New note", its new-task dialog
// started from where it was asked, and the narrow window's Views sheet.
import { createContext, useContext } from "react";
import type { Start } from "@/components/quick-add";
import { localDay } from "@/core/time";
import type { View } from "@/lib/nav";

export type ShellActions = { newNote: () => void; add: (s: Start) => void; openMenu: () => void };

export const ShellContext = createContext<ShellActions | null>(null);

export function useShell(): ShellActions {
  const s = useContext(ShellContext);
  if (!s) throw new Error("useShell outside the shell");
  return s;
}

/** A task added from Today starts on Today. */
export const startOf = (kind: View["kind"]): Start => ({ schedule: kind === "today" ? { when: localDay(), evening: false } : null });

/** The screen is the whole window (an installed app): clear of a notch, the gesture bar and rounded corners. */
export const INSETS = "pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]";
