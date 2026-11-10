// A task's `notes` are markdown, and a picture in them is an image line: `![alt](https://…)` as the clipper and the agent
// write it for a picture on the web, or `![alt](../attachments/<note-id>/<name>.jpg)` as a note's photo is written (a
// task has no attachments of its own: it points at a note's). These read the lines; web/src/components/task-detail.tsx draws them.

const FENCE = /^\s*(```|~~~)/;
const IMAGE = /!\[[^\]]*\]\(\s*<?([^)\s>]+)/g;
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
