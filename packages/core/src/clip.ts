// The clip routes' shapes (server/pb_hooks/clip.pb.js, lib/clip.js), one home for the clients that call them: the
// Chrome extension (extension/src/clip.ts) and the web app's share page (web/src/services/clip.ts). A clip is a page, text or a
// picture sent in two steps: suggest (where JEV would file it, writes nothing), then save, where the owner chose: a new
// note, an existing note, an open task (its `notes`), or a new task (a picture then in a new note the task links to).
// Pure and import-free, so the extension bundles it as it is.

/** The picture a clip carries: its address and the page's words for it. Its bytes are the save's `file` part. */
export type ClipImage = { src: string; alt?: string; caption?: string };

/** What is clipped. `url` is "" for what the phone shares as text or a photo (a selection or a picture then). */
export type ClipPage = { url: string; title: string; selection?: string; text?: string; image?: ClipImage };

/** Where a clip goes. A new note's or new task's `title` is the owner's, when they gave one; else the server titles it
 *  from the clip. */
export type Target = { kind: "new"; title?: string } | { kind: "note"; path: string } | { kind: "task"; id: string } | { kind: "newtask"; title?: string };
export const NEW: Target = { kind: "new" };
export const NEW_TASK: Target = { kind: "newtask" };

/** `target` with the owner's typed title, when it is a new note or task and they typed one. */
export const titled = (target: Target, title: string): Target =>
  (target.kind === "new" || target.kind === "newtask") && title.trim() ? { kind: target.kind, title: title.trim() } : target;

/** A note or task JEV rates at least a 1 in 20 chance (`p`). */
export type Suggestion = { kind: "note"; path: string; title: string; p: number } | { kind: "task"; id: string; title: string; p: number };

/** `pick`: the top option, a suggestion's target or new. `line`: the page's own line on what it is, sent back to save. */
export type Suggestions = { suggestions: Suggestion[]; pick: Target; line?: string };

/** What became of the summary the owner asked for ("Add a summary"): written into the clip; skipped, there being nothing to
 *  summarise it from (a picture with no words of its own, a page with no text); or failed (no key, or the model did). The
 *  clip is saved in every case. */
export type Summary = "added" | "skipped" | "failed";

/** `summary` is there only when one was asked for. A task `created` from a picture's clip has `note`: the path of the new
 *  note holding the picture, which the task links to (`about`, core/record-links.ts). */
export type ClipResult =
  | { kind: "note"; path: string; title: string; action: "created" | "appended"; summary?: Summary }
  | { kind: "task"; id: string; title: string; action: "created" | "appended"; note?: string; summary?: Summary };

/** The suggest request's JSON. `note`: the owner's words, context for where it goes. `look`: the picture as JEV sees it
 *  (base64 JPEG, long edge 768, padded up to 280 a side). */
export const suggestBody = (page: ClipPage, note: string, look?: string) =>
  ({ ...page, note: note || undefined, image: page.image && { ...page.image, look } });

/** The save request's `@jsonPayload`; `tags` the owner's (a new note carries them, an append adds those missing). The page's text is not sent again, unless `summary` (the owner ticked "Add a summary"):
 *  then it goes too, the summary being written from it. The picture's JPEG goes beside it as the `file` part for a note, a
 *  new one included, and for a new task (kept in a new note it links to); an existing task keeps no picture, so none goes
 *  there (`sendsFile`). */
export const saveBody = (page: ClipPage, line: string | undefined, target: Target, note: string, summary: boolean, tags: string[] = []) => {
  const { url, title, selection, image } = page;
  return { url, title, selection, line, target, note: note || undefined, image, tags: tags.length ? tags : undefined, ...(summary && { summary: true, text: page.text }) };
};

/** The clip/tags route's answer: every defined tag with JEV's probability that the page belongs under it, best first, and
 *  the ones preselected (every sure one, else the best likely one). The owner's choice goes back as the save's `tags`. */
export type ClipTags = { tags: { name: string; p: number }[]; picked: string[] };

/** Whether a save sends the picture's bytes: a clip of a picture to a note, a new note or a new task, never to an
 *  existing task. */
export const sendsFile = (page: ClipPage, target: Target) => !!page.image && target.kind !== "task";

export const sameTarget = (a: Target, b: Target) =>
  a.kind === b.kind && (a.kind === "note" ? a.path === (b as typeof a).path : a.kind === "task" ? a.id === (b as typeof a).id : true);

export const targetOf = (s: Suggestion): Target => (s.kind === "note" ? { kind: "note", path: s.path } : { kind: "task", id: s.id });

/** One option offered to the owner. */
export type Choice = { target: Target; label: string; hint?: string };

/** The pick first, then the others best first, then a new note unless that is the pick, then a new task. `picture`: an
 *  existing task keeps only a link to it, a new task the picture in a note of its own, which the hints say. */
export function choices(s: Suggestions, picture: boolean): Choice[] {
  const rest = s.suggestions.map((x): Choice => {
    const pct = `${Math.round(x.p * 100)}%`;
    return x.kind === "note"
      ? { target: targetOf(x), label: `Append to ${x.title}`, hint: pct }
      : { target: targetOf(x), label: `Add to task ${x.title}`, hint: picture ? `${pct}, link only` : pct };
  });
  const fresh: Choice = { target: NEW, label: "New note" };
  const task: Choice = picture ? { target: NEW_TASK, label: "New task", hint: "picture in a linked note" } : { target: NEW_TASK, label: "New task" };
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
