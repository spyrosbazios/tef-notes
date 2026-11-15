// Keeps the screen on while something the owner is talking to would otherwise be cut off by it sleeping (a Talk conversation).
// The browser lets a screen wake lock go whenever the page is hidden, so it is taken again as the page comes back.

/** Takes the lock now and keeps it until the returned function is called. Quiet where the browser has none, or refuses one. */
export function keepAwake(): () => void {
  let lock: WakeLockSentinel | null = null, held = true;
  const take = async () => {
    if (!held || lock || !navigator.wakeLock || document.visibilityState !== "visible") return;
    try {
      const l = await navigator.wakeLock.request("screen");
      l.addEventListener("release", () => { if (lock === l) lock = null; });
      if (held) lock = l; else void l.release();
    } catch { /* refused (a low battery, a hidden page): the screen sleeps as it would */ }
  };
  const back = () => { void take(); };
  document.addEventListener("visibilitychange", back);
  back();
  return () => {
    held = false;
    document.removeEventListener("visibilitychange", back);
    void lock?.release();
    lock = null;
  };
}
