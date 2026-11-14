// A note's outline: its headings in order, each with the first words under it. What the note's contents rail draws
// (components/note-contents.tsx). Only top-level headings count: one inside a quote or a list is part of that block.
import type { Node } from "prosemirror-model";
import { schema } from "./markdown";

export type OutlineItem = {
  /** 1 to 6. */
  level: number;
  title: string;
  /** The words between this heading and the next, cut to `LEAD` characters: what its card shows. */
  lead: string;
  /** Where the heading starts in the document, when the outline was read. */
  pos: number;
};

const LEAD = 160;

/** The headings of `doc` that have words, in order. */
export function outlineOf(doc: Node): OutlineItem[] {
  const out: OutlineItem[] = [];
  let open: OutlineItem | null = null;
  doc.forEach((node, pos) => {
    if (node.type === schema.nodes.heading) {
      const title = node.textContent.trim();
      open = title ? { level: node.attrs.level, title, lead: "", pos } : null;
      if (open) out.push(open);
    } else if (open && open.lead.length < LEAD) {
      const text = node.textContent.replace(/\s+/g, " ").trim();
      if (text) open.lead = `${open.lead} ${text}`.trim().slice(0, LEAD);
    }
  });
  return out;
}

/** Two outlines draw the same (their headings may have moved in the document): nothing to redraw. */
export const sameOutline = (a: OutlineItem[], b: OutlineItem[]) =>
  a.length === b.length && a.every((x, i) => { const y = b[i]; return x.level === y.level && x.title === y.title && x.lead === y.lead; });
