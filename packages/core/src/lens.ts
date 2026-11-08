// Lenses: a global filter. A lens is a name, a set of tags and a set of excluded tags; while one is on, an item (a note or
// a task) is shown only if it carries any of its tags (or the lens has none) and none of its excluded ones, and what is made
// under it carries the lens's first tag. The definitions are records of
// the server's `lenses` collection (pb_migrations/1793600000_lenses.js), so every device has the same ones; *which* lens
// is on is one of the owner's preferences (prefs.ts), shared by every device, and none is the unfiltered app.
// Pure and platform-neutral: the clients, the CLI and the agent's context all read it from here.
import { fold } from "./notes";
import { ACCENT_NAMES, type AccentName } from "./theme";
import { dedupeTags } from "./todo";

/** `accent`: the primary colour the app takes while the lens is on (theme.ts `ACCENTS`), or null to keep the device's own. */
export type Lens = { rec: string; name: string; tags: string[]; exclude: string[]; accent: LensAccentName | null };
/** A lens names a colour of its own, never "theme" (none is the device's pick). */
export type LensAccentName = Exclude<AccentName, "theme">;
/** What a form edits: everything but the record id. */
export type LensFields = Omit<Lens, "rec">;

/** The longest lens name and the most tags one takes (pb_migrations/1793600000_lenses.js). */
export const LENS_NAME_MAX = 40;
export const LENS_TAGS_MAX = 20;

// ---- the wire

/** A `lenses` record as a Lens: the one defensive reader (a column of the wrong shape is empty, tags are cleaned). */
export const lensOf = (r: any): Lens => ({
  rec: typeof r?.id === "string" ? r.id : "",
  name: typeof r?.name === "string" ? r.name.trim() : "",
  tags: tagsOf(r?.tags),
  exclude: tagsOf(r?.exclude),
  accent: accentOf(r?.accent),
});

/** A stored accent, or null for none (empty, unknown, or "theme", which is the device's own pick anyway). */
const accentOf = (v: unknown): LensAccentName | null =>
  ACCENT_NAMES.find((a): a is LensAccentName => a === v && a !== "theme") ?? null;

const tagsOf = (v: unknown): string[] => (Array.isArray(v) ? dedupeTags(v.filter((t: unknown): t is string => typeof t === "string")) : []);

/** A Lens's columns, as the server stores them. */
export const lensColumns = (l: LensFields) =>
  ({ name: l.name.trim(), tags: dedupeTags(l.tags), exclude: dedupeTags(l.exclude), accent: accentOf(l.accent) ?? "" });

/** The primary colour on screen: the lens's when one is on and has one, else the device's own pick. */
export const lensAccent = (lens: Lens | null | undefined, own: AccentName): AccentName => lens?.accent ?? own;

/** Why `l` can't be saved as a lens, or null: a name, and at least one tag to include or exclude (a lens of neither would
 *  filter nothing), never one tag both. */
export function lensProblem(l: Pick<LensFields, "name" | "tags" | "exclude">): string | null {
  const name = l.name.trim(), tags = dedupeTags(l.tags), exclude = dedupeTags(l.exclude);
  if (!name) return "A lens needs a name.";
  if (name.length > LENS_NAME_MAX) return `A lens name is at most ${LENS_NAME_MAX} characters.`;
  if (!tags.length && !exclude.length) return "A lens needs at least one tag to show or hide.";
  if (tags.length > LENS_TAGS_MAX || exclude.length > LENS_TAGS_MAX) return `A lens takes at most ${LENS_TAGS_MAX} tags of each kind.`;
  const both = tags.find((t) => exclude.some((x) => fold(x) === fold(t)));
  if (both) return `#${both} can't be both shown and hidden.`;
  return null;
}

/** The lens a device has on: its definition by record id, or null when none is on or the one chosen is gone (deleted from
 *  another device). */
export const activeLens = (lenses: readonly Lens[], rec: string | null | undefined): Lens | null =>
  (rec ? lenses.find((l) => l.rec === rec) : undefined) ?? null;

// ---- filtering

type Tagged = { tags: readonly string[] };

/** Whether `item` (a note, a task, a card: anything with tags) is in `lens`: it carries any of its tags (any item, when the
 *  lens only excludes) and none of its excluded ones, ignoring case and tonos. No lens is no filter, so everything is in it. */
export const inLens = (lens: Lens | null | undefined, item: Tagged): boolean => {
  if (!lens) return true;
  const has = (t: string) => item.tags.some((x) => fold(x) === fold(t));
  return (!lens.tags.length || lens.tags.some(has)) && !lens.exclude.some(has);
};

/** `items` that are in `lens`; the same array when there is none. */
export const withinLens = <T extends Tagged>(lens: Lens | null | undefined, items: readonly T[]): readonly T[] =>
  lens ? items.filter((i) => inLens(lens, i)) : items;

// ---- making

/** The tag a new item carries under `lens`: its first. */
export const lensTag = (lens: Lens | null | undefined): string | undefined => lens?.tags[0];

/** `tags` with the lens's first tag added (once, ignoring case), for a note or task made while `lens` is on. */
export const inheritTags = (lens: Lens | null | undefined, tags: readonly string[] = []): string[] => {
  const t = lensTag(lens);
  return t ? dedupeTags([...tags, t]) : [...tags];
};

// ---- the assistant

/** Opens the `filter` an assistant client sends while a lens is on; the server's prompt tells the model to scope to it. */
export const LENS_FILTER = "lens: ";

/** The lens as the assistant's page context says it: `lens: Work (tags: work, clients; not: archive)`. */
export const lensFilter = (lens: Lens): string => {
  const parts = [lens.tags.length ? `tags: ${lens.tags.join(", ")}` : "", lens.exclude.length ? `not: ${lens.exclude.join(", ")}` : ""];
  return `${LENS_FILTER}${lens.name} (${parts.filter(Boolean).join("; ")})`;
};

/** The `filter` of an assistant context: the lens first (the server cuts long text from the end), then the list's own
 *  search or chip. undefined when neither is set. */
export const contextFilter = (lens: Lens | null | undefined, filter?: string): string | undefined =>
  [lens ? lensFilter(lens) : "", filter ?? ""].filter(Boolean).join(" · ") || undefined;
