// A tick that can be taken back: ticking a task starts a short wait (`TICK_MS`), and only when it runs out is the task
// completed (written, and for a repeating task its next round made). A second tap inside the wait takes the tick back and
// nothing was written. Pure timing, no I/O: the caller says what settling does and may pass its own clock.

/** How long a tick waits before it is written. */
export const TICK_MS = 1500;

export type Clock = {
  set: (f: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
};

const real: Clock = { set: (f, ms) => setTimeout(f, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

export type Ticker = {
  /** Start the wait for `id`, or take it back when one is running: "waiting" or "taken-back". */
  toggle: (id: string) => "waiting" | "taken-back";
  /** Whether `id` is waiting to be written. */
  has: (id: string) => boolean;
  /** Take back `id`'s tick if it is waiting; whether it was. */
  cancel: (id: string) => boolean;
  /** Settle everything waiting now: the page is going away, where a timer may not get to run. */
  flush: () => void;
};

/** `settle(id)` is called once when `id`'s wait runs out (or is flushed), after which `id` is no longer waiting. */
export function ticker(settle: (id: string) => void, wait = TICK_MS, clock: Clock = real): Ticker {
  const pending = new Map<string, unknown>();
  const done = (id: string) => {
    if (!pending.has(id)) return;
    clock.clear(pending.get(id));
    pending.delete(id);
    settle(id);
  };
  return {
    toggle(id) {
      if (pending.has(id)) { clock.clear(pending.get(id)); pending.delete(id); return "taken-back"; }
      pending.set(id, clock.set(() => done(id), wait));
      return "waiting";
    },
    has: (id) => pending.has(id),
    cancel(id) {
      if (!pending.has(id)) return false;
      clock.clear(pending.get(id));
      pending.delete(id);
      return true;
    },
    flush: () => { for (const id of [...pending.keys()]) done(id); },
  };
}
