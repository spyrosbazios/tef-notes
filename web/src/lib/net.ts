// Whether the server can be reached, as one small store the whole app reads (hooks/online.ts) and the transport feeds
// (services/api.ts, services/realtime.ts). Two things make the app "offline": the browser says so (navigator.onLine and
// its online/offline events), or the server itself refused to answer (a request failed at the network, the realtime
// stream dropped) while the browser still claims a connection, as when the tailnet is down. Either clears the moment the
// browser says online again or a request or the stream gets through.

export type Net = { browser: boolean; reached: boolean };
export type NetEvent = "online" | "offline" | "reached" | "unreachable";

/** The state after `e`. The browser's own "online" is a fresh start: it clears a failure noted while it was down. */
export function next(s: Net, e: NetEvent): Net {
  switch (e) {
    case "online": return { browser: true, reached: true };
    case "offline": return { ...s, browser: false };
    case "reached": return s.reached ? s : { ...s, reached: true };
    case "unreachable": return s.reached ? { ...s, reached: false } : s;
  }
}

/** Offline in the sense of the banner and of a write refused up front. */
export const isOffline = (s: Net) => !s.browser || !s.reached;

let state: Net = { browser: typeof navigator === "undefined" ? true : navigator.onLine, reached: true };
const listeners = new Set<() => void>();

/** The current state; the same object until an event changes it (what useSyncExternalStore needs). */
export const getNet = (): Net => state;

export function note(e: NetEvent): void {
  const s = next(state, e);
  if (s.browser === state.browser && s.reached === state.reached) return;
  state = s;
  listeners.forEach((l) => l());
}

export function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

if (typeof addEventListener === "function") {
  addEventListener("online", () => note("online"));
  addEventListener("offline", () => note("offline"));
}
