// The masonry's arithmetic (components/masonry.tsx): how many columns fit, and which tile goes in which.
const COL_REM = 15, GAP_REM = 0.75, TWO_REM = 18;

/** How many 15rem columns, 0.75rem apart, fit `width` px (CSS columns' own count); two from 18rem, as the phone's tiles are. */
export function columnCount(width: number, rem: number): number {
  const n = Math.max(1, Math.floor((width + GAP_REM * rem) / ((COL_REM + GAP_REM) * rem)));
  return width >= TWO_REM * rem ? Math.max(2, n) : n;
}

/** `items` dealt to columns in turn: item i goes to column i mod n, so reading across is reading in order. */
export function deal<T>(items: T[], n: number): T[][] {
  const cols: T[][] = Array.from({ length: n }, () => []);
  items.forEach((item, i) => cols[i % n].push(item));
  return cols;
}

/** The tiles on screen in one masonry, by id. A tile that changes column is a second element with its id while the first one
 *  leaves (each column has its own presence): the newcomer comes in without a fade and the one it replaces is hidden at once,
 *  instead of two tiles fading over each other. One per masonry: a note shown in two of them (two chat answers, two tag groups)
 *  is two tiles, and neither hides the other. */
export class OnScreen<T> {
  private readonly tiles = new Map<string, Set<T>>();
  /** Whether a tile with `id` is on screen already: one arriving now is it moving, not new. */
  has(id: string): boolean { return this.tiles.has(id); }
  /** `node` is on screen as `id`: the ones it replaces (to hide), and its leaving. */
  arrive(id: string, node: T): { replaced: T[]; leave: () => void } {
    const all = this.tiles.get(id) ?? new Set<T>(), replaced = [...all];
    all.add(node);
    this.tiles.set(id, all);
    return { replaced, leave: () => { all.delete(node); if (!all.size && this.tiles.get(id) === all) this.tiles.delete(id); } };
  }
}
