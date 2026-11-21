// Which tiles are on screen, each masonry its own (components/masonry.tsx provides it, a tile reads it: note-list.tsx `Tile`).
import { createContext, useContext, useLayoutEffect, useState, type RefObject } from "react";
import type { OnScreen } from "@/lib/masonry";

export const MasonryTiles = createContext<OnScreen<HTMLElement> | null>(null);

/** Whether the tile `id` arrived from another column of its masonry (it glides in, no fade); the one it replaces is hidden at once.
 *  `shared`: the tile takes part (its `layoutId` is set). Outside a masonry a tile is always new. */
export function useMoved(id: string, shared: boolean, el: RefObject<HTMLElement | null>): boolean {
  const tiles = useContext(MasonryTiles);
  const [moved] = useState(() => shared && !!tiles?.has(id));
  useLayoutEffect(() => {
    const node = el.current;
    if (!shared || !node || !tiles) return;
    const { replaced, leave } = tiles.arrive(id, node);
    for (const o of replaced) o.style.visibility = "hidden";
    return leave;
  }, [id, shared, el, tiles]);
  return moved;
}
