// A clock for relative ages on screen (ago() in core/time.ts), so they keep moving.
import { useEffect, useState } from "react";

/** A clock that ticks every `ms`, so ages on screen don't freeze at the value they were drawn with. */
export function useNow(ms = 60_000) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
