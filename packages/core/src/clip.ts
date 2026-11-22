// The clip routes' shapes (server/pb_hooks/clip.pb.js, lib/clip.js), one home for the clients that call them: the
// Chrome extension (extension/src/clip.ts), the web app's share page (web/src/services/clip.ts) and the Android companion
// (android/, by companion.ts's copies). A clip is a page, text, pictures or PDFs sent in two steps: suggest (where JEV
// would file it, writes nothing), then save, where the owner chose: a new note, an existing note, an open task (its
// `notes`), or a new task (its files then in a new note the task links to).
// Pure and import-free, so the extension bundles it as it is.

/** A picture a clip carries: its address ("" for one shared from another app) and the page's words for it. */
type ClipImage = { src: string; alt?: string; caption?: string };
/** A PDF a clip carries, by its name as shared. */
type ClipPdf = { name: string };

/** What is clipped. `url` is "" for what the phone shares as text or files (a selection, pictures or PDFs then). The
 *  files' bytes are the save's `file` parts, the pictures' JPEGs then the PDFs, in order (`clipFiles`). */
export type ClipPage = { url: string; title: string; selection?: string; text?: string; images?: ClipImage[]; pdfs?: ClipPdf[] };

/** At most this many pictures and PDFs in one clip (server/pb_hooks/lib/clip.js FILES). */
export const CLIP_FILES = 10;

/** A page's text, cut to this many characters before it is sent (`text` of a clip: the summary is written from it; the server
 *  accepts a little more, lib/clip.js `PAGE_CHARS`). */
export const CLIP_TEXT = 50000;

/** How many files a clip carries. */
export const clipFiles = (page: ClipPage) => (page.images?.length ?? 0) + (page.pdfs?.length ?? 0);

/** What a clip's files are called in a line the owner reads: "picture", "pictures", "PDF", "PDFs" or "files"; null for none. */
export function filesWord(page: ClipPage): string | null {
  const i = page.images?.length ?? 0, p = page.pdfs?.length ?? 0;
  return i && p ? "files" : i ? (i > 1 ? "pictures" : "picture") : p ? (p > 1 ? "PDFs" : "PDF") : null;
}

/** Where a clip goes. A new note's or new task's `title` is the owner's, when they gave one; else the server titles it
 *  from the clip. */
export type Target = { kind: "new"; title?: string } | { kind: "note"; path: string } | { kind: "task"; id: string } | { kind: "newtask"; title?: string };
export const NEW: Target = { kind: "new" };
export const NEW_TASK: Target = { kind: "newtask" };

/** `target` with the owner's typed title, when it is a new note or task and they typed one. */
export const titled = (target: Target, title: string): Target =>
  (target.kind === "new" || target.kind === "newtask") && title.trim() ? { kind: target.kind, title: title.trim() } : target;

/** A note or task JEV rates at least a 1 in 20 chance (`p`). */
type Suggestion = { kind: "note"; path: string; title: string; p: number } | { kind: "task"; id: string; title: string; p: number };

/** `pick`: the top option, a suggestion's target or new. `line`: the page's own line on what it is, sent back to save. */
export type Suggestions = { suggestions: Suggestion[]; pick: Target; line?: string };

/** What became of the summary the owner asked for ("Add a summary"): written into the clip; skipped, there being nothing to
 *  summarise it from (a picture with no words of its own, a page with no text); or failed (no key, or the model did). The
 *  clip is saved in every case. */
type Summary = "added" | "skipped" | "failed";

/** `summary` is there only when one was asked for. A task `created` from a picture's clip has `note`: the path of the new
 *  note holding the picture, which the task links to (`about`, core/record-links.ts). */
export type ClipResult =
  | { kind: "note"; path: string; title: string; action: "created" | "appended"; summary?: Summary }
  | { kind: "task"; id: string; title: string; action: "created" | "appended"; note?: string; summary?: Summary };

/** The suggest request's JSON. `note`: the owner's words, context for where it goes. `look`: the first picture as JEV sees
 *  it (base64 JPEG, long edge 768, a small one made up to 280 on its short side: photos.ts `lookSize`). */
export const suggestBody = (page: ClipPage, note: string, look?: string) =>
  ({ ...page, note: note || undefined, images: page.images?.map((im, i) => (i === 0 && look ? { ...im, look } : im)) });

/** The save request's `@jsonPayload`; `tags` the owner's (a new note carries them, an append adds those missing). The page's text is not sent again, unless `summary` (the owner ticked "Add a summary"):
 *  then it goes too, the summary being written from it. The files go beside it as `file` parts for a note, a new one
 *  included, and for a new task (kept in a new note it links to); an existing task keeps no file, so none goes there
 *  (`sendsFiles`). */
export const saveBody = (page: ClipPage, line: string | undefined, target: Target, note: string, summary: boolean, tags: string[], id: string) => {
  const { url, title, selection, images, pdfs } = page;
  return { id, url, title, selection, line, target, note: note || undefined, images, pdfs, tags: tags.length ? tags : undefined, ...(summary && { summary: true, text: page.text }) };
};

/** A save's id: 15 of a-z0-9, as a record id is (server/pb_hooks/lib/clip.js `clipId` takes exactly these). */
export const clipId = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(15));
  return Array.from(bytes, (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
};

/** `saveBody` with the id the save carries, for a client that sends a save again by hand (the owner presses Save once more after
 *  a failure). The server records every save under its id and answers one it has already done with the first's answer, so a save
 *  whose answer was lost lands once: `body` for the very same save as the last call's (the same page, target, note, tags...) keeps
 *  that call's id, any other save gets a new one; `landed` once a save has been answered, so the next of the same words is a new
 *  save. One per client. */
export function saveBodies() {
  let last: { key: string; id: string } | undefined;
  return {
    body(page: ClipPage, line: string | undefined, target: Target, note: string, summary: boolean, tags: string[]) {
      const key = JSON.stringify(saveBody(page, line, target, note, summary, tags, ""));
      if (last?.key !== key) last = { key, id: clipId() };
      return saveBody(page, line, target, note, summary, tags, last.id);
    },
    landed() { last = undefined; },
  };
}

/** The clip/tags route's answer: every defined tag with JEV's probability that the page belongs under it, best first, and
 *  the ones preselected (every sure one, else the best likely one). The owner's choice goes back as the save's `tags`. */
export type ClipTags = { tags: { name: string; p: number }[]; picked: string[] };

/** Offered beside the picked tags: one JEV gives at least this chance. */
const TAG_OFFER = 0.3;

/** The tags not picked, as the owner is shown them: `offered` the likely ones, best first as the route sent them, to add
 *  with a tap; `more` every other defined tag by name, for a list. */
export function unpickedTags(all: ClipTags["tags"], picked: readonly string[]): { offered: ClipTags["tags"]; more: string[] } {
  const rest = all.filter((t) => !picked.includes(t.name));
  return { offered: rest.filter((t) => t.p >= TAG_OFFER), more: rest.filter((t) => t.p < TAG_OFFER).map((t) => t.name).sort((a, b) => a.localeCompare(b)) };
}

/** Whether a save sends the files' bytes: a clip with files to a note, a new note or a new task, never to an existing task. */
export const sendsFiles = (page: ClipPage, target: Target) => clipFiles(page) > 0 && target.kind !== "task";

const sameTarget = (a: Target, b: Target) =>
  a.kind === b.kind && (a.kind === "note" ? a.path === (b as typeof a).path : a.kind === "task" ? a.id === (b as typeof a).id : true);

export const targetOf = (s: Suggestion): Target => (s.kind === "note" ? { kind: "note", path: s.path } : { kind: "task", id: s.id });

/** One option offered to the owner. */
export type Choice = { target: Target; label: string; hint?: string };

/** The pick first, then the others best first, then a new note unless that is the pick, then a new task. `files`: what
 *  the clip's files are called (`filesWord`), null for none: an existing task keeps none of them, a new task keeps them in
 *  a note of its own, which the hints say. */
export function choices(s: Suggestions, files: string | null): Choice[] {
  const rest = s.suggestions.map((x): Choice => {
    const pct = `${Math.round(x.p * 100)}%`;
    return x.kind === "note"
      ? { target: targetOf(x), label: `Append to ${x.title}`, hint: pct }
      : { target: targetOf(x), label: `Add to task ${x.title}`, hint: files ? `${pct}, no ${files}` : pct };
  });
  const fresh: Choice = { target: NEW, label: "New note" };
  const task: Choice = files ? { target: NEW_TASK, label: "New task", hint: `${files} in a linked note` } : { target: NEW_TASK, label: "New task" };
  const top = rest.find((c) => sameTarget(c.target, s.pick));
  return top ? [top, ...rest.filter((c) => c !== top), fresh, task] : [fresh, ...rest, task];
}

/** What the owner is told when they asked for a summary and it was not written; null when it was, or none was asked for. */
export const summaryNotice = (r: ClipResult) =>
  r.summary === "skipped" ? "Saved without a summary: there was no text to write it from."
  : r.summary === "failed" ? "Saved without a summary: it couldn't be written."
  : null;

/** What was done, in a line. */
export const describe = (r: ClipResult) =>
  r.kind === "task" ? (r.action === "created" ? "Created a new task" : "Added to a task")
  : r.action === "created" ? "Created a new note" : "Appended to a note";
