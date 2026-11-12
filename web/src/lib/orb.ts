// Talk's orb: how it looks in each state (`LOOKS`), how a look eases into the next (`approach`) and how a level is followed
// (`follow`), and the canvas drawing of one frame (`drawOrb`). The numbers are the whole personality: listening breathes with the owner's
// voice, speaking is bigger, faster and moves with the assistant's, working is small and quiet with an arc circling it, waiting
// holds still and sends a ring out, again and again, until it is answered. Colours are never in here: the caller reads them from the
// theme's tokens and hands them in. Pure apart from the context it draws on: test/talk.test.ts.
import type { TalkState } from "@/lib/talk";

/** One state's look; every field is a number so one look can ease into another. */
export type Look = {
  /** The body's radius as a share of half the canvas. */
  radius: number;
  /** How far the edge wanders from a circle, as a share of the radius (the level adds to it). */
  wobble: number;
  /** How fast it wanders, radians a second. */
  speed: number;
  /** The soft light behind it, 0..1. */
  glow: number;
  /** The arc circling it, 0..1: opacity. */
  spin: number;
  /** The rings going out from it, 0..1: opacity. */
  pulse: number;
  /** 0 in the brand's colour, 1 in the error's. */
  fail: number;
  /** The body's opacity. */
  body: number;
};

export const LOOKS: Record<TalkState, Look> = {
  idle: { radius: 0.5, wobble: 0.02, speed: 0.35, glow: 0.2, spin: 0, pulse: 0, fail: 0, body: 0.6 },
  connecting: { radius: 0.46, wobble: 0.02, speed: 0.6, glow: 0.25, spin: 1, pulse: 0, fail: 0, body: 0.6 },
  listening: { radius: 0.52, wobble: 0.035, speed: 0.7, glow: 0.45, spin: 0, pulse: 0, fail: 0, body: 0.9 },
  speaking: { radius: 0.58, wobble: 0.07, speed: 1.9, glow: 0.85, spin: 0, pulse: 0, fail: 0, body: 1 },
  working: { radius: 0.44, wobble: 0.012, speed: 0.4, glow: 0.3, spin: 1, pulse: 0, fail: 0, body: 0.75 },
  waiting: { radius: 0.5, wobble: 0.008, speed: 0.3, glow: 0.55, spin: 0, pulse: 1, fail: 0, body: 0.95 },
  failed: { radius: 0.42, wobble: 0, speed: 0, glow: 0.08, spin: 0, pulse: 0, fail: 1, body: 0.7 },
};

/** `from` moved toward `to` over `dt` seconds, exponentially: the same pace whatever the frame rate, never overshooting. */
export function approach(from: Look, to: Look, dt: number, rate = 5): Look {
  const k = 1 - Math.exp(-rate * Math.max(0, dt));
  const out = { ...from };
  for (const key of Object.keys(to) as (keyof Look)[]) out[key] = from[key] + (to[key] - from[key]) * k;
  return out;
}

/** A level followed over `dt` seconds: it rises quickly and falls slowly, so a voice reads as one swelling shape, not as flicker. */
export function follow(shown: number, level: number, dt: number): number {
  const k = 1 - Math.exp(-(level > shown ? 22 : 5) * Math.max(0, dt));
  return shown + (level - shown) * k;
}

/** The colours a frame is drawn in, as CSS colour strings read from the theme's tokens. */
export type Colors = { brand: string; fg: string; down: string };

const POINTS = 48;

/** The body's edge: a circle wandering by three waves, drawn as one smooth curve through the midpoints between its points. */
function blob(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, wobble: number, t: number) {
  const at = (i: number) => {
    const a = ((i % POINTS) / POINTS) * Math.PI * 2;
    const w = Math.sin(a * 3 + t) + 0.6 * Math.sin(a * 5 - t * 1.3) + 0.4 * Math.sin(a * 2 + t * 0.7);
    const rr = r * (1 + wobble * w);
    return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr] as const;
  };
  g.beginPath();
  const [sx, sy] = at(0), [nx, ny] = at(1);
  g.moveTo((sx + nx) / 2, (sy + ny) / 2);
  for (let i = 1; i <= POINTS; i++) {
    const [x, y] = at(i), [x2, y2] = at(i + 1);
    g.quadraticCurveTo(x, y, (x + x2) / 2, (y + y2) / 2);
  }
  g.closePath();
}

/** One frame on a square canvas of `size` pixels. `t`: seconds; `level`: the voice being followed, 0..1, already smoothed. */
export function drawOrb(g: CanvasRenderingContext2D, size: number, look: Look, t: number, level: number, c: Colors) {
  g.clearRect(0, 0, size, size);
  const mid = size / 2, r = mid * look.radius * (1 + level * 0.2);
  // The body, in the brand's colour and the error's as `fail` blends them
  blob(g, mid, mid, r, look.wobble + level * 0.14, t * look.speed);
  g.globalAlpha = look.body * (1 - look.fail);
  g.fillStyle = c.brand;
  g.fill();
  g.globalAlpha = look.body * look.fail;
  g.fillStyle = c.down;
  g.fill();
  // A light on its upper left, so it reads as a thing and not a disc
  g.save();
  g.clip();
  const lit = g.createRadialGradient(mid - r * 0.35, mid - r * 0.4, 0, mid - r * 0.35, mid - r * 0.4, r * 1.3);
  lit.addColorStop(0, c.fg);
  lit.addColorStop(1, c.brand);
  g.globalAlpha = 0.28 * look.body * (1 - look.fail);
  g.fillStyle = lit;
  g.fillRect(0, 0, size, size);
  g.restore();
  g.lineCap = "round";
  g.strokeStyle = c.brand;
  g.lineWidth = Math.max(2, size * 0.014);
  // The arc circling it while it connects or a tool runs, on a faint ring
  if (look.spin > 0.01) {
    const ring = r * 1.3, a = t * 1.7;
    g.globalAlpha = look.spin * 0.18;
    g.beginPath(); g.arc(mid, mid, ring, 0, Math.PI * 2); g.stroke();
    g.globalAlpha = look.spin * 0.85;
    g.beginPath(); g.arc(mid, mid, ring, a, a + Math.PI * 0.55); g.stroke();
  }
  // Rings going out and fading, two at once half a turn apart
  if (look.pulse > 0.01) {
    for (const lag of [0, 0.5]) {
      const phase = (t * 0.55 + lag) % 1;
      g.globalAlpha = look.pulse * (1 - phase) * 0.55;
      g.beginPath(); g.arc(mid, mid, r * (1.08 + phase * 0.55), 0, Math.PI * 2); g.stroke();
    }
  }
  g.globalAlpha = 1;
}
