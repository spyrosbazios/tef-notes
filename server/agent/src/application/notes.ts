// Request-scoped note reads, search and writes over the shared transport.
// Writes carry the revision read, retry additive edits, and three-way merge whole-file edits.
// Listings are invalidated after writes; taint is persisted in the same write and never cleared.
import { fold, newNotePath, noteKindOf, parseNote, snippetOf, type NoteKind } from "@/core/notes";
import { mergedWrite } from "@/core/note-read";
import * as pb from "@/core/pocketbase";
import { HttpError } from "@/core/http";
import { listTags, type TagDef } from "@/core/tags";
import { allPdfs } from "../pdfs";
import { semantic, type Near } from "../semantic";

export type Meta = {
  rec: string; path: string; kind: NoteKind; rev: number; text: string; title: string; tags: string[]; pinned: boolean;
  archived: boolean; color?: string; updated: number; tainted: boolean;
};

/** The text actually written, including any merge, for callers to present as they choose. */
export type NoteSaved = { saved: string; rev: number; text: string } | { error: string };

const PAGE = 500, TRIES = 3, RRF = 60;
const FIELDS = "id,path,kind,rev,text,title,tags,pinned,archived,color,updated,tainted";

import { time } from "./metadata";
export { time } from "./metadata";

const metaOf = (r: any): Meta => ({
  rec: r.id, path: r.path, kind: noteKindOf(r.kind), rev: r.rev, text: r.text ?? "", title: r.title || parseNote(r.path, r.text ?? "").title, tags: r.tags ?? [],
  pinned: !!r.pinned, archived: !!r.archived, color: r.color || undefined, updated: time(r.updated), tainted: !!r.tainted,
});

/** A search result; `match`: found by its words, its meaning, or both. */
export type Hit = { path: string; title: string; snippet: string; match: "words" | "meaning" | "both" };

export class NoteService {
  private rows?: Promise<Map<string, Meta>>;
  constructor(readonly server: pb.Server) {}

  /** Every record, notes and memory, by path. */
  all(): Promise<Map<string, Meta>> {
    return (this.rows ??= (async () => {
      const out = new Map<string, Meta>();
      for (let page = 1; ; page++) {
        const j = await pb.call(this.server, `collections/notes/records?fields=${FIELDS}&perPage=${PAGE}&page=${page}&skipTotal=1`);
        for (const r of j.items) out.set(r.path, metaOf(r));
        if (j.items.length < PAGE) return out;
      }
    })());
  }

  async meta(path: string) { return (await this.all()).get(path); }
  async list() { return [...(await this.all()).values()]; }
  async tainted() { return new Set((await this.list()).filter((n) => n.tainted).map((n) => n.path)); }
  /** Every tag a note may carry: the Settings definitions, then any other tag already on a note (typed in the editor,
   *  never defined), spelled as first seen. */
  async tags(): Promise<TagDef[]> {
    const [defs, notes] = await Promise.all([listTags(this.server), this.list()]);
    const out = [...defs];
    for (const t of notes.flatMap((n) => n.tags))
      if (!out.some((d) => fold(d.name) === fold(t))) out.push({ rec: "", name: t, description: "" });
    return out;
  }

  /** The file as the server has it now; null when there's none. */
  async read(path: string) { return pb.read(this.server, path); }

  /** The words' hits (`words`) and the meaning's (semantic.ts), fused by reciprocal rank: a note both find comes
   *  first. Without the model (it failed to load) the words' hits alone. */
  async search(query: string, limit: number): Promise<Hit[]> {
    const notes = await this.list(), words = this.words(notes, query), title = new Map(notes.map((n) => [n.path, n.title]));
    let near: Near[] = [];
    try { near = await semantic().near(notes, query, limit * 2, await allPdfs(this.server, notes)); } catch (e) { console.error(`agent: search by meaning failed: ${(e as Error).message}`); }
    const fused = new Map<string, Hit & { score: number }>();
    const add = (list: { path: string; snippet: string }[], how: Hit["match"]) => list.forEach((h, i) => {
      const had = fused.get(h.path), score = 1 / (RRF + i + 1);
      if (had) { had.score += score; had.match = "both"; }
      else fused.set(h.path, { path: h.path, title: title.get(h.path) ?? h.path, snippet: h.snippet, match: how, score });
    });
    add(words, "words");
    add(near, "meaning");
    return [...fused.values()].sort((a, b) => b.score - a.score).slice(0, limit).map((h): Hit => ({ path: h.path, title: h.title, snippet: h.snippet, match: h.match }));
  }

  /** Notes holding every word of `query` in their title or text, accents, tonos and case ignored (the phone's search
   *  folds the same way): title hits first, then newest edit; a snippet around the first hit. */
  private words(notes: Meta[], query: string) {
    const words = fold(query).split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const hits = notes.filter((n) => n.path.startsWith("notes/")).flatMap((n) => {
      const body = parseNote(n.path, n.text).body, t = fold(n.title), b = fold(body);
      if (!words.every((w) => t.includes(w) || b.includes(w))) return [];
      return [{ n, inTitle: words.filter((w) => t.includes(w)).length, snippet: snippetAt(body, b, words) || snippetOf(body) }];
    });
    hits.sort((x, y) => y.inTitle - x.inTitle || y.n.updated - x.n.updated);
    return hits.map((h) => ({ path: h.n.path, snippet: h.snippet }));
  }

  /** A new note at a free path, under a record id made once: a path taken meanwhile moves the note aside to the next free one
   *  (the id is unused until a create lands), and a create whose answer was lost is sent again under the same id, so it lands once. */
  async create(title: string, text: (path: string) => string, taint: boolean): Promise<NoteSaved> {
    const rec = pb.recordId();
    for (let i = 0; i < TRIES; i++) {
      const path = newNotePath(title, Date.now(), new Set((await this.all()).keys())), body = text(path);
      try {
        const r = await pb.createdUnder(
          () => pb.call(this.server, "collections/notes/records", pb.json("POST", { id: rec, ...pb.noteColumns(path, body), ...(taint ? { tainted: true } : {}) })),
          () => pb.get(this.server, rec));
        this.rows = undefined;
        return { saved: r.path, rev: r.rev, text: body };
      } catch (e) {
        if (!(e instanceof pb.Conflict)) throw e;
        this.rows = undefined;
      }
    }
    return { error: "Couldn't find a free name for the note; try another title." };
  }

  /** Gone, on the rev it was read at; a write meanwhile re-reads and deletes that (it is the same wish). Its photos go
   *  with it and its links by the relations' cascade (pb_hooks/notes.pb.js). */
  async remove(path: string): Promise<{ deleted: string; rev: number } | { error: string }> {
    for (let i = 0; i < TRIES; i++) {
      const cur = await this.read(path);
      if (!cur) { this.rows = undefined; return { error: `No note ${path}.` }; }
      try {
        await pb.remove(this.server, cur);
        this.rows = undefined;
        return { deleted: path, rev: cur.rev };
      } catch (e) {
        if (!(e instanceof pb.Conflict)) throw e;
      }
    }
    return { error: `${path} keeps changing; try again in a moment.` };
  }

  /** `edit(the file as it is now)` written over the rev it was read at. A refusal (someone wrote meanwhile) re-reads:
   *  an edit that adds is redone on the new text. A whole-file edit names its `base`: the rev the writer read, and the text
   *  read at it (null when it has none: a clipped read). The edit is made over that text and 3-way merged with whatever the
   *  file became since, however long ago (a card waited for an answer while the owner typed), and refused where they
   *  overlap, or when the file moved and the base text is not there to merge from. `base.rev` 0 is a file that wasn't there
   *  (its text ""). `create`: a missing file starts empty (the memory file). */
  async change(path: string, edit: (text: string) => string, o: { taint?: boolean; base?: { rev: number; text: string | null }; create?: boolean } = {}): Promise<NoteSaved> {
    const { base } = o;
    let baseText = base ? (base.rev === 0 ? "" : base.text) : null, mine: string | undefined;
    const made = pb.recordId();                          // a missing file is created under this one id, however many tries it takes
    for (let i = 0; i < TRIES; i++) {
      const cur = await this.read(path);
      if (!cur) {
        if (!o.create) return { error: `No note ${path}: it was deleted meanwhile.` };
        const first = edit("");
        try {
          const r = await pb.createdUnder(
            () => pb.call(this.server, "collections/notes/records", pb.json("POST", { id: made, ...pb.noteColumns(path, first), ...(o.taint ? { tainted: true } : {}) })),
            () => pb.get(this.server, made));
          this.rows = undefined;
          return { saved: path, rev: r.rev, text: first };
        } catch (e) {
          if (e instanceof pb.Conflict) continue;      // made meanwhile: edit that one
          throw e;
        }
      }
      let next: string;
      if (!base || cur.rev === base.rev) {
        // Nothing written since the read (or an additive edit): over the file as it is, which is the base
        next = edit(cur.text);
        if (base) { baseText = cur.text; mine = next; }
      } else {
        if (baseText == null) return { error: `${path} changed since you read it (rev ${base.rev}, now ${cur.rev}). read_note it again and redo the change.` };
        mine ??= edit(baseText);
        const m = mergedWrite(baseText, mine, cur.text);
        if (m == null) return { error: `${path} was changed meanwhile, in the same lines. read_note it again and redo the change.` };
        next = m;
      }
      try {
        const r = await pb.call(this.server, `collections/notes/records/${cur.rec}`,
          pb.json("PATCH", { ...pb.noteColumns(path, next), rev: cur.rev, ...(o.taint ? { tainted: true } : {}) }));
        this.rows = undefined;
        return { saved: path, rev: r.rev, text: next };
      } catch (e) {
        if (e instanceof HttpError && e.status === 404) return { error: `No note ${path}: it was deleted meanwhile.` };
        if (e instanceof pb.Conflict) continue;
        if (!pb.unanswered(e)) throw e;
        // No answer: the write may have landed. Redoing an edit that adds on the text it already is in would add it twice.
        const now = await this.read(path);
        if (!now) return { error: `No note ${path}: it was deleted meanwhile.` };
        if (now.rev !== cur.rev && pb.landed(cur.text, next, now.text)) { this.rows = undefined; return { saved: path, rev: now.rev, text: now.text }; }
      }
    }
    return { error: `${path} keeps changing under this edit; try again in a moment.` };
  }
}

/** ~160 chars of `body` around the first word found in its folded copy `folded` (folding keeps precomposed text's
 *  length, so an index in one is an index in the other). */
function snippetAt(body: string, folded: string, words: string[]) {
  const at = Math.min(...words.map((w) => folded.indexOf(w)).filter((i) => i >= 0));
  if (!Number.isFinite(at)) return "";
  const from = Math.max(0, at - 60), to = Math.min(body.length, at + 100);
  const s = body.slice(from, to).replace(/\s+/g, " ").trim();
  return `${from > 0 ? "…" : ""}${s}${to < body.length ? "…" : ""}`;
}

/** `tags` as the defined names they match (case and tonos ignored), or an error naming the ones no definition or note has. */
export async function definedTags(notes: Pick<NoteService, "tags">, tags: string[]): Promise<{ tags: string[] } | { error: string }> {
  const defs = await notes.tags(), out: string[] = [], bad: string[] = [];
  for (const t of tags) {
    const d = defs.find((x) => fold(x.name) === fold(t.trim()));
    if (d) { if (!out.includes(d.name)) out.push(d.name); } else bad.push(t);
  }
  return bad.length
    ? { error: `Not an existing tag: ${bad.join(", ")}. Use only: ${defs.map((d) => d.name).join(", ") || "(none defined)"}.` }
    : { tags: out };
}
