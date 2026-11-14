// The moves a scene is made of, each a function of the scene's clock: a device coming on, a piece arriving, a press. With
// the clock's `typed` and `after` (a tick is a task that is done once its moment has come), they are the whole vocabulary: a
// new scene is a screen, its words and a few of these with their times.
import { useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { rise, useClock } from "./clock";
import { useFrame } from "./Scene";

/** A device coming on: up from a little below and a little small, to `top` pixels under the frame's top. A scene that
 *  changes `top` over time pans along a device taller than the frame. */
export function Enter({ at = 0.15, top = 0, children }: { at?: number; top?: number; children: ReactNode }) {
  const p = useClock().ramp(at, 0.8);
  return <div style={{ marginTop: top, opacity: p, transform: `translateY(${(1 - p) * 44}px) scale(${0.97 + p * 0.03})`, transformOrigin: "50% 0" }}>{children}</div>;
}

/** A piece that is not there until `at`, then rises into its place: a chat's next line, a card. */
export function Arrive({ at, children }: { at: number; children: ReactNode }) {
  const { after, ramp } = useClock();
  return after(at) ? <div style={rise(ramp(at, 0.4), 14)}>{children}</div> : null;
}

/** A press on the control a screen marks `data-tap="<on>"`, at `at`: a fingertip comes down on it, presses, and leaves a
 *  ring. The control is found on the page each frame, so the press follows it wherever the screen has been put. */
export function Tap({ on, at }: { on: string; at: number }) {
  const frame = useFrame();
  const { t, ramp } = useClock();
  const [spot, setSpot] = useState<{ x: number; y: number } | null>(null);
  const live = t >= at - 0.5 && t < at + 0.6;
  useLayoutEffect(() => {
    const target = live ? frame?.querySelector(`[data-tap="${on}"]`) : null;
    if (!frame || !target) { if (spot) setSpot(null); return; }
    // The frame may itself be shown scaled (the Studio's preview): its own pixels are what the spot is in.
    const outer = frame.getBoundingClientRect(), box = target.getBoundingClientRect(), k = frame.offsetWidth / outer.width;
    const x = (box.left + box.width / 2 - outer.left) * k, y = (box.top + box.height / 2 - outer.top) * k;
    if (!spot || Math.abs(x - spot.x) > 0.5 || Math.abs(y - spot.y) > 0.5) setSpot({ x, y });
  });
  if (!frame || !live || !spot) return null;
  const down = ramp(at - 0.45, 0.35), press = ramp(at - 0.08, 0.08) - ramp(at, 0.25), ring = ramp(at, 0.5), away = ramp(at + 0.25, 0.3);
  return createPortal(
    <div className="pointer-events-none absolute" style={{ left: spot.x, top: spot.y }}>
      <span className="absolute -left-10 -top-10 size-20 rounded-full border-2 border-fg/50" style={{ opacity: (1 - ring) * 0.9 * (t >= at ? 1 : 0), transform: `scale(${0.6 + ring * 1.3})` }} />
      <span className="absolute -left-7 -top-7 size-14 rounded-full border-2 border-fg/70 bg-fg/25 shadow-lift" style={{ opacity: down * (1 - away), transform: `scale(${1.5 - down * 0.5 - press * 0.18})` }} />
    </div>,
    frame,
  );
}
