// The masonry's arithmetic (components/masonry.tsx): how many columns fit, and which tile goes in which.
const COL_REM = 15, GAP_REM = 0.75;

/** How many 15rem columns, 0.75rem apart, fit `width` px (CSS columns' own count). */
export function columnCount(width: number, rem: number): number {
  return Math.max(1, Math.floor((width + GAP_REM * rem) / ((COL_REM + GAP_REM) * rem)));
}

/** `items` dealt to columns in turn: item i goes to column i mod n, so reading across is reading in order. */
export function deal<T>(items: T[], n: number): T[][] {
  const cols: T[][] = Array.from({ length: n }, () => []);
  items.forEach((item, i) => cols[i % n].push(item));
  return cols;
}
