// Local-time clocks and day keys. Chain and trip times are unix seconds; only localDay takes ms (Date.now()).

const two = (n: number) => String(n).padStart(2, "0");

/** `YYYY-MM-DD` in local time — the filename/date convention used across journal/. */
export const localDay = (t = Date.now()) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
};
export const ymd = (ts: number) => localDay(ts * 1000);

export const hm = (ts: number) => { const d = new Date(ts * 1000); return `${two(d.getHours())}:${two(d.getMinutes())}`; };
export const mdhm = (ts: number) => { const d = new Date(ts * 1000); return `${two(d.getMonth() + 1)}-${two(d.getDate())} ${hm(ts)}`; };
/** `YYYY-MM-DD HH:MM`, the strategies' frontmatter time format. */
export const stamp = (ts: number) => `${ymd(ts)} ${hm(ts)}`;

export function localMidnight(now = new Date()) {
  return Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000);
}

/** Start of the rolling 24h window the Stats tab shows — what pump.fun's 1D means, not since midnight. */
export const since24h = (now = Date.now()) => Math.floor(now / 1000) - 86_400;

// Relative ages for list rows and the sync line. Notes are read by "how long ago", not by clock time.
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `now`, `5m`, `3h`, `6d`, then `3 Oct`, then `2025-10-03` for another year. `t` in ms. */
export function ago(t: number, now = Date.now()) {
  const s = Math.max(0, (now - t) / 1000);
  if (s < 45) return "now";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)}d`;
  const d = new Date(t);
  return d.getFullYear() === new Date(now).getFullYear() ? `${d.getDate()} ${MON[d.getMonth()]}` : localDay(t);
}
