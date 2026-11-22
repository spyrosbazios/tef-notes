// A note's contents as state: its headings (the editor's outline, editor/outline.ts), which section is being read, and the jump to
// one. Drawn by components/note-contents.tsx. A note with fewer than `MIN` headings has none: there is nothing to find in it.
// `useScrub` is the phone's way through them: a finger held at the note's left edge, then dragged.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import type { Editor, OutlineItem } from "@/editor";
import { calm } from "@/hooks/media";
import { haptic } from "@/lib/haptics";

const MIN = 3;
/** A jump leaves this much above the heading; a heading within `AHEAD` of the top is the section being read. */
const GAP = 24, AHEAD = 96;
/** How long the phone's ticks stay after the last scroll. */
const LINGER = 1000;
/** The longest a jump's glide is waited for. */
const SETTLE = 1200;

const NONE: OutlineItem[] = [];

export type Contents = {
  /** The headings the rail draws: none when the note has fewer than `MIN`, or the editor isn't up yet. */
  items: OutlineItem[];
  /** The index of the section being read. */
  current: number;
  /** The note scrolled within the last second. */
  scrolling: boolean;
  /** Glide to a heading. It is the section being read from the start, so the mark goes straight to it, not through the ones passed. */
  jump: (index: number) => void;
  /** The element the note scrolls in. */
  scroller: RefObject<HTMLElement | null>;
};

/** The contents of the note in `editor`, read against `scroller`, the element the note scrolls in. */
export function useContents(editor: Editor | null, scroller: RefObject<HTMLElement | null>): Contents {
  const subscribe = useCallback((changed: () => void) => editor?.subscribe(changed) ?? (() => {}), [editor]);
  const outline = useSyncExternalStore(subscribe, () => editor?.outline() ?? NONE);
  const items = outline.length < MIN ? NONE : outline;
  const [current, setCurrent] = useState(0), [scrolling, setScrolling] = useState(false);
  // A jump under way: the scroll's readings wait until it lands (`scrollend`, or `SETTLE` where a jump moved nothing)
  const jumping = useRef(0);

  useEffect(() => {
    const el = scroller.current;
    if (!el || !editor || !items.length) return;
    let frame = 0, timer = 0;
    const read = () => {
      frame = 0;
      if (jumping.current) return;
      const line = el.getBoundingClientRect().top + AHEAD;
      let at = 0;
      items.forEach((_, i) => { const h = editor.headingElement(i); if (h && h.getBoundingClientRect().top <= line) at = i; });
      // The last section may be too short to ever reach the top: at the end of the note it is the one being read
      if (el.scrollTop > 0 && el.scrollTop + el.clientHeight >= el.scrollHeight - 2) at = items.length - 1;
      setCurrent(at);
    };
    const later = () => { if (!frame) frame = requestAnimationFrame(read); };
    const scrolled = () => {
      later();
      setScrolling(true);
      clearTimeout(timer);
      timer = window.setTimeout(() => setScrolling(false), LINGER);
    };
    const landed = () => { clearTimeout(jumping.current); jumping.current = 0; later(); };
    later();
    el.addEventListener("scroll", scrolled, { passive: true });
    el.addEventListener("scrollend", landed);
    // Pictures loading and the window resizing move the headings without a scroll
    const sized = new ResizeObserver(later);
    sized.observe(el);
    sized.observe(editor.dom);
    return () => { el.removeEventListener("scroll", scrolled); el.removeEventListener("scrollend", landed); sized.disconnect(); cancelAnimationFrame(frame); clearTimeout(timer); };
  }, [editor, items, scroller]);

  const jump = (index: number) => {
    const el = scroller.current, h = editor?.headingElement(index);
    if (!el || !h) return;
    clearTimeout(jumping.current);
    jumping.current = window.setTimeout(() => { jumping.current = 0; }, SETTLE);
    setCurrent(index);
    el.scrollTo({ top: el.scrollTop + h.getBoundingClientRect().top - el.getBoundingClientRect().top - GAP, behavior: calm() ? "auto" : "smooth" });
  };

  return { items, current: Math.min(current, Math.max(0, items.length - 1)), scrolling, jump, scroller };
}

/** The strip at the note's left edge a hold starts in (the text's own padding: no words under it), how long the finger rests
 *  before the rail opens, and how far it may stray meanwhile: further is a scroll, which is left alone. */
const EDGE = 28, HOLD = 220, SLOP = 8;
/** An open rail's row, a fingertip's step, tightened when the headings would not fit between the margins. */
const STEP = 24, MARGIN = 16;

export type Scrub = {
  /** The heading under the finger. */
  index: number;
  /** The open rail's row height. */
  row: number;
  /** The open rail's top and the scroller's height, both in px from the scroller's top. */
  top: number;
  height: number;
};

/** The scrub in progress, null when there is none. A finger held still at the left edge opens the rail around it, the section
 *  being read under the finger; dragged, the note glides to each heading it comes onto and stays where the finger lifts. Only
 *  those glides move the note: its own scrolling is off for the scrub, so the drag never scrolls it. Android's back gesture is a
 *  swipe inward from that edge: a hold and a drag along it are neither, and a touch the system takes over puts the note back. */
export function useScrub(contents: Contents, on: boolean): Scrub | null {
  const [scrub, setScrub] = useState<Scrub | null>(null);
  const latest = useRef(contents);
  useEffect(() => { latest.current = contents; });
  const { scroller } = contents, count = contents.items.length;

  useEffect(() => {
    const el = scroller.current;
    if (!on || !el || !count) return;
    let timer = 0, start: { x: number; y: number } | null = null, held: Scrub | null = null, from = 0;
    const indexAt = (y: number, s: Scrub) => Math.max(0, Math.min(count - 1, Math.floor((y - el.getBoundingClientRect().top - s.top) / s.row)));
    const open = () => {
      if (!start) return;
      const box = el.getBoundingClientRect(), row = Math.min(STEP, (box.height - 2 * MARGIN) / count);
      const at = start.y - box.top, current = Math.min(latest.current.current, count - 1);
      // The section being read under the finger, as far as the margins allow
      const top = Math.max(MARGIN, Math.min(box.height - MARGIN - count * row, at - (current + 0.5) * row));
      held = { index: 0, row, top, height: box.height };
      held.index = indexAt(start.y, held);
      from = current;
      el.style.overflowY = "hidden";     // no scroll of the browser's own under the scrub, one already begun included
      haptic("tick");
      if (held.index !== from) latest.current.jump(held.index);
      setScrub(held);
    };
    const stop = () => {
      clearTimeout(timer);
      start = null;
      if (!held) return null;
      const { index } = held;
      held = null;
      el.style.overflowY = "";
      setScrub(null);
      return index;
    };
    const cancel = () => { const index = stop(); if (index !== null && index !== from) latest.current.jump(from); };
    const down = (e: TouchEvent) => {
      stop();
      const t = e.touches[0];
      if (e.touches.length !== 1 || t.clientX - el.getBoundingClientRect().left > EDGE) return;
      start = { x: t.clientX, y: t.clientY };
      timer = window.setTimeout(open, HOLD);
    };
    const move = (e: TouchEvent) => {
      const t = e.touches[0];
      if (held) {
        e.preventDefault();
        const index = indexAt(t.clientY, held);
        if (index === held.index) return;
        held = { ...held, index };
        haptic("tap");
        latest.current.jump(index);
        setScrub(held);
      } else if (start && Math.hypot(t.clientX - start.x, t.clientY - start.y) > SLOP) stop();
    };
    // A long press is Android's own menu too: not while it opens the rail
    const menu = (e: Event) => { if (start) e.preventDefault(); };
    el.addEventListener("touchstart", down, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", stop);
    el.addEventListener("touchcancel", cancel);
    el.addEventListener("contextmenu", menu);
    return () => {
      stop();
      el.removeEventListener("touchstart", down);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", stop);
      el.removeEventListener("touchcancel", cancel);
      el.removeEventListener("contextmenu", menu);
    };
  }, [on, count, scroller]);

  return scrub;
}
