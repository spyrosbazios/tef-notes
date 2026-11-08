// The URL's query, as the router reads and writes it (router.ts `parseSearch`/`stringifySearch`), and each route's typed search
// (its `validateSearch`). Flat and plain on purpose: `?t=<id>`, `?tags=a,b`, `?section=agent`, `?note=<id>`, `?shared=1`, the
// addresses the service worker, the reminders (`/today?t=<id>`, server/agent) and a pasted link already use, never the router's
// JSON-in-the-query. Every value is a string; a list is its items comma-joined (a tag never holds a comma). A validator keeps what
// it understands and drops the rest, so a hand-typed or stale address opens the screen rather than an error. Pure: test/route-search.test.ts.

export type Raw = Record<string, unknown>;

/** `?a=1&b=x,y` as `{ a: "1", b: "x,y" }`: strings only, the validators give them their types. */
export function parseSearch(search: string): Raw {
  return Object.fromEntries(new URLSearchParams(search.startsWith("?") ? search.slice(1) : search));
}

/** The query for a search object, with its `?` (or "" when nothing is left): an empty value or list is left out, a list is
 *  comma-joined, each item encoded on its own so the commas stay readable. */
export function stringifySearch(search: Raw): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(search)) {
    if (v == null) continue;
    const text = Array.isArray(v) ? v.map((x) => encodeURIComponent(String(x))).join(",") : encodeURIComponent(String(v));
    if (text) parts.push(`${encodeURIComponent(k)}=${text}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

/** A non-empty string, or nothing. */
const text = (v: unknown): string | undefined => (typeof v === "string" && v ? v : typeof v === "number" ? String(v) : undefined);

/** A list from `a,b` (or a list already), blanks dropped; nothing when empty. */
const list = (v: unknown): string[] | undefined => {
  const items = (Array.isArray(v) ? v.map(String) : typeof v === "string" ? v.split(",") : []).map((s) => s.trim()).filter(Boolean);
  return items.length ? items : undefined;
};

/** Every screen of the shell: the note laid over it (`?note=<id>`, its filename's id). */
export type ShellSearch = { note?: string };
export const shellSearch = (raw: Raw): ShellSearch => ({ note: text(raw.note) });

/** Home: its notes under every one of these tags. */
export type HomeSearch = { tags?: string[] };
export const homeSearch = (raw: Raw): HomeSearch => ({ tags: list(raw.tags) });

/** A task list: the task open beside it (its record id). */
export type ListSearch = { t?: string };
export const listSearch = (raw: Raw): ListSearch => ({ t: text(raw.t) });

/** Settings' sections, in their order (settings-pane.tsx draws each). */
export const SETTINGS_SECTIONS = ["appearance", "layout", "server", "agent", "reminders", "tags", "import", "export"] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/** Settings: the section open. */
export type SettingsSearch = { section?: SettingsSection };
export const settingsSearch = (raw: Raw): SettingsSearch => {
  const s = text(raw.section);
  return { section: SETTINGS_SECTIONS.find((id) => id === s) };
};

/** The share page: `1` when the service worker stashed a share, `err` when it could not read one. */
export type ShareSearch = { shared?: "1" | "err" };
export const shareSearch = (raw: Raw): ShareSearch => {
  const s = text(raw.shared);
  return { shared: s === "1" || s === "err" ? s : undefined };
};
