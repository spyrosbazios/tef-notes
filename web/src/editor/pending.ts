// Work done at most once per `ms` however often it is asked for: the body is read out of the document once per burst of
// typing, not once per key. `poke` says there is something to do (the first poke starts the wait, later ones join it);
// `flush` does it now (the editor lost its focus, the page is going away, the owner pressed a shortcut) and does nothing
// when nothing waits.
export type Pending = { poke(): void; flush(): void };

export function pending(f: () => void, ms: number): Pending {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = () => {
    clearTimeout(timer);
    timer = undefined;
    f();
  };
  return {
    poke() { timer ??= setTimeout(run, ms); },
    flush() { if (timer !== undefined) run(); },
  };
}
