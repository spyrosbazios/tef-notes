/** PocketBase's `2026-10-30 12:00:00.000Z` as ms. */
export const time = (s: string) => Date.parse(s.replace(" ", "T"));

export type Stamp = { created: number; updated: number };
