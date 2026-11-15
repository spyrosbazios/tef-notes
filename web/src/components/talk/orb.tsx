// Talk's orb: the conversation as one shape in the theme's accent. A canvas drawn from the frame loop (hooks/talk.ts `useFrames`),
// not from React state: each frame eases the look toward the state's (lib/orb.ts `LOOKS`: listening breathes, speaking swells, working
// is small with an arc circling it, waiting sends rings out) and follows the real level of whichever side is talking: the owner's
// microphone while it listens, the voice coming out of the speaker while it speaks. A soft light behind it is a blurred element
// that is only scaled and faded (compositor work). Colours are the theme's tokens, read from CSS (they change with the theme and a
// lens), never written here. Under reduced motion nothing loops: it is drawn once per state, still, its levels unused.
import { useShouldReduceMotion } from "@animate-ui/react/utils/motion";
import { useCallback, useEffect, useRef } from "react";
import { useFrames, useTalkSession } from "@/hooks/talk";
import { approach, drawOrb, follow, LOOKS, type Colors, type Look } from "@/lib/orb";
import type { TalkState } from "@/lib/talk";
import { cn } from "@/lib/utils";

const token = (cs: CSSStyleDeclaration, name: string) => cs.getPropertyValue(name).trim();
const colorsOf = (el: Element): Colors => {
  const cs = getComputedStyle(el);
  return { brand: token(cs, "--tf-brand"), fg: token(cs, "--tf-fg"), down: token(cs, "--tf-down") };
};

/** A look held still: no wander, nothing moving but what the state itself is (a ring, an arc). */
const stilled = (state: TalkState): Look => ({ ...LOOKS[state], wobble: 0 });

export function Orb({ state, muted, className }: { state: TalkState; muted: boolean; className?: string }) {
  const session = useTalkSession(), calm = useShouldReduceMotion();
  const canvas = useRef<HTMLCanvasElement>(null), glow = useRef<HTMLDivElement>(null);
  // What the frame loop reads: the state asked for, and what has been drawn so far
  const want = useRef({ state, muted });
  const drawn = useRef({ look: LOOKS[state], level: 0, colors: null as Colors | null, read: 0 });
  useEffect(() => { want.current = { state, muted }; });

  const paint = useCallback((dt: number, t: number) => {
    const c = canvas.current, g = c?.getContext("2d");
    if (!c || !g || !c.width) return;
    const d = drawn.current, { state: s, muted: m } = want.current;
    if (!d.colors || t - d.read > 0.5) { d.colors = colorsOf(c); d.read = t; }
    const levels = session.levels();
    d.look = calm ? stilled(s) : approach(d.look, LOOKS[s], dt);
    d.level = calm ? 0 : follow(d.level, s === "speaking" ? levels.voice : s === "listening" && !m ? levels.mic : 0, dt);
    drawOrb(g, c.width, d.look, calm ? 0 : t, d.level, d.colors);
    const light = glow.current;
    if (light) {
      light.style.opacity = String(0.08 + d.look.glow * 0.4);
      light.style.transform = `scale(${0.8 + d.look.glow * 0.25 + d.level * 0.3})`;
    }
  }, [session, calm]);

  // The canvas's pixels follow its box (at most 2 per CSS pixel), and a still orb is drawn again when its box or its state changes
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const fit = () => {
      const px = Math.round(c.clientWidth * Math.min(2, devicePixelRatio));
      if (px && c.width !== px) { c.width = c.height = px; if (calm) paint(0, 0); }
    };
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(c);
    return () => watch.disconnect();
  }, [calm, paint]);

  // Reduced motion: no loop, one frame per state, and again every so often so a new theme is picked up
  useEffect(() => {
    if (!calm) return;
    paint(0, 0);
    const again = setInterval(() => { drawn.current.colors = null; paint(0, 0); }, 1000);
    return () => clearInterval(again);
  }, [calm, state, muted, paint]);

  useFrames(paint, !calm);

  return (
    <div className={cn("relative aspect-square", className)}>
      <div ref={glow} aria-hidden className="absolute inset-[8%] rounded-full bg-brand opacity-30 blur-3xl will-change-[transform,opacity]" />
      <canvas ref={canvas} aria-hidden className="relative size-full" />
    </div>
  );
}
