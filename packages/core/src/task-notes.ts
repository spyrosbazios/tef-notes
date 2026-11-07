// A task's `notes` are markdown, and a picture in them is an image line: `![alt](https://…)` as the clipper and the agent
// write it for a picture on the web, or `![alt](../attachments/<note-id>/<name>.jpg)` as a note's photo is written (a
// task has no attachments of its own: it points at a note's). These read the lines; mobile/src/ui/task-notes.tsx draws them.

const FENCE = /^\s*(```|~~~)/;
const IMAGE = /!\[[^\]]*\]\(\s*<?([^)\s>]+)/g;
const ATTACHMENT = /(?<![\w./-])(?:\.\.?\/|\/)?attachments\/([^\s/)"'<>]+)\/([^\s)"'<>]+)/g;

const decode = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };

/** The addresses of the images `md` shows, in order; a fenced block's lines are code, not pictures. */
export function imagesOf(md: string): string[] {
  const out: string[] = [];
  let fence = false;
  for (const line of md.split("\n")) {
    if (FENCE.test(line)) { fence = !fence; continue; }
    if (!fence) for (const m of line.matchAll(IMAGE)) out.push(m[1]);
  }
  return out;
}

/** Every note's attachment `md` points at (`../attachments/<id>/<name>`), once each. */
export function attachmentsIn(md: string): { noteId: string; name: string }[] {
  const seen = new Map<string, { noteId: string; name: string }>();
  for (const m of md.matchAll(ATTACHMENT)) {
    const noteId = decode(m[1]), name = decode(m[2]);
    seen.set(`${noteId}/${name}`, { noteId, name });
  }
  return [...seen.values()];
}

/** `md` with each attachment reference pointed at whatever `resolve` gives for it (the file:// copy on this phone); left as it is when it gives nothing. */
export function resolveAttachments(md: string, resolve: (noteId: string, name: string) => string | undefined): string {
  return md.replace(ATTACHMENT, (all, id: string, name: string) => resolve(decode(id), decode(name)) ?? all);
}

const MARKUP = /\[[^\]]*\]\([^)]+\)|<https?:\/\/|https?:\/\/\S|\*\*[^*]+\*\*|(?<![\w*])[*_][^*_\s][^*_]*[*_](?![\w*])|`[^`]+`|^\s{0,3}(#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s?|```|~~~)/m;

/** Whether `md` holds markdown worth drawing (a link, a bare URL, emphasis, a list, a heading, code or a picture); plain text stays a text box. */
export const readsAsMarkdown = (md: string): boolean => MARKUP.test(md) || imagesOf(md).length > 0;

/** `md` as a task's notes are read: each line its own line, as typed in the box (markdown would join them into one paragraph); fenced code left as it is. */
export function withLineBreaks(md: string): string {
  let fence = false;
  const lines = md.split("\n");
  return lines.map((line, i) => {
    if (FENCE.test(line)) { fence = !fence; return line; }
    const next = lines[i + 1];
    return !fence && line.trim() && next?.trim() && !FENCE.test(next) ? `${line.replace(/\s+$/, "")}  ` : line;
  }).join("\n");
}
