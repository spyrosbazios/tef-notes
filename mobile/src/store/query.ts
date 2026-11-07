// The one react-query client, and the app-state hook that pauses its polling in the background.
import { focusManager, QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { AppState } from "react-native";

export const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

/** Query keys read in more than one place (the agent reads the panels' cache), so they can't drift apart. */
export const qk = {
  wallet: (id?: string) => (id ? ["wallet", id] : ["wallet"]),
  price: (chain: string) => ["price", chain],
};

export function useAppFocus() {
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => focusManager.setFocused(s === "active"));
    return () => sub.remove();
  }, []);
}
