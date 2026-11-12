// Talk as state, held above the routes (components/talk/provider.tsx): whether the server offers it, the one conversation there can be
// (lib/talk-session.ts) and what reads it, and the frame loop that draws its levels. The conversation outlives every screen: the
// assistant opens notes and moves the app while it talks.
import { queryOptions, useQuery } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useRef, useSyncExternalStore } from "react";
import type { TalkSession, TalkSnapshot } from "@/lib/talk-session";
import * as talk from "@/services/talk";

/** Whether the server has the speech model: the answer to `GET /agent/talk`, null when it is off, undefined until asked. */
export const talkStatusQuery = queryOptions({ queryKey: ["talk"], queryFn: talk.status, staleTime: 5 * 60_000 });
export const useTalkStatus = () => useQuery(talkStatusQuery);

/** Talk is on offer here: the server has it. Where it isn't, the app has no tab, sidebar item, settings row or palette entry for it. */
export const useTalkOn = (): boolean => !!useTalkStatus().data;

/** Whether a tab or a sidebar item is on offer (core/prefs.ts): all are, but Talk's when the server hasn't it. */
export function useOffered(): (item: string) => boolean {
  const on = useTalkOn();
  return (item) => item !== "talk" || on;
}

export const TalkContext = createContext<TalkSession | null>(null);

export function useTalkSession(): TalkSession {
  const s = useContext(TalkContext);
  if (!s) throw new Error("useTalkSession outside the TalkProvider");
  return s;
}

/** The conversation as it is now; every change re-renders what reads it, and nothing else does (the levels never do: `useFrames`). */
export function useTalk(): TalkSnapshot & { session: TalkSession } {
  const session = useTalkSession();
  return { ...useSyncExternalStore(session.subscribe, session.snapshot), session };
}

/** Calls `draw` before every frame the page paints while `on`, with the seconds since the last one (at most a tenth: a page left in
 *  the background doesn't lurch when it returns) and the clock's seconds. The meters are drawn from here, straight onto the canvas
 *  or the element, so a level never costs a React render. */
export function useFrames(draw: (dt: number, t: number) => void, on = true) {
  const latest = useRef(draw);
  useEffect(() => { latest.current = draw; });
  useEffect(() => {
    if (!on) return;
    let id = 0, last = performance.now();
    const tick = (now: number) => {
      latest.current(Math.min(0.1, (now - last) / 1000), now / 1000);
      last = now;
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [on]);
}
