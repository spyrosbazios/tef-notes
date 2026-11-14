// A note's contents as state: its headings (the editor's outline, editor/outline.ts), which section is being read, and the jump to
// one. Drawn by components/note-contents.tsx. A note with fewer than `MIN` headings has none: there is nothing to find in it.
import { useCallback, useEffect, useState, useSyncExternalStore, type RefObject } from "react";
import type { Editor, OutlineItem } from "@/editor";
import { calm } from "@/hooks/media";

const MIN = 3;
/** A jump leaves this much above the heading; a heading within `AHEAD` of the top is the section being read. */
const GAP = 24, AHEAD = 96;
/** How long the phone's ticks stay after the last scroll. */
const LINGER = 1000;

const NONE: OutlineItem[] = [];

export type Contents = {
  /** The headings the rail draws: none when the note has fewer than `MIN`, or is shown as markdown source. */
  items: OutlineItem[];
  /** The index of the section being read. */
  current: number;
  /** The note scrolled within the last second. */
  scrolling: boolean;
  jump: (index: number) => void;
};

/** The contents of the note in `editor`, read against `scroller`, the element the note scrolls in. */
export function useContents(editor: Editor | null, scroller: RefObject<HTMLElement | null>): Contents {
  const subscribe = useCallback((changed: () => void) => editor?.subscribe(changed) ?? (() => {}), [editor]);
  const outline = useSyncExternalStore(subscribe, () => editor?.outline() ?? NONE);
  const items = outline.length < MIN ? NONE : outline;
  const [current, setCurrent] = useState(0), [scrolling, setScrolling] = useState(false);

  useEffect(() => {
    const el = scroller.current;
    if (!el || !editor || !items.length) return;
    let frame = 0, timer = 0;
    const read = () => {
      frame = 0;
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
    later();
    el.addEventListener("scroll", scrolled, { passive: true });
    // Pictures loading and the window resizing move the headings without a scroll
    const sized = new ResizeObserver(later);
    sized.observe(el);
    sized.observe(editor.dom);
    return () => { el.removeEventListener("scroll", scrolled); sized.disconnect(); cancelAnimationFrame(frame); clearTimeout(timer); };
  }, [editor, items, scroller]);

  const jump = (index: number) => {
    const el = scroller.current, h = editor?.headingElement(index);
    if (!el || !h) return;
    el.scrollTo({ top: el.scrollTop + h.getBoundingClientRect().top - el.getBoundingClientRect().top - GAP, behavior: calm() ? "auto" : "smooth" });
  };

  return { items, current: Math.min(current, Math.max(0, items.length - 1)), scrolling, jump };
}
