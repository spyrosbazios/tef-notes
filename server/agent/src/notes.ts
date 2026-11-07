// The agent's view of the notes: PocketBase over HTTP, through the clients' shared core (packages/core). One Notes per
// request: the listing loads once (the prompt's index, list_notes, search_notes, the path checks) and again after a
// write. Every write is the clients' compare-and-swap (server/pb_hooks/rev.pb.js): it sends the rev it read, and a
// refusal re-reads and redoes the edit; a whole-body rewrite is 3-way merged with what moved meanwhile instead, or
// refused where the two overlap. A note written with web text in view is marked `tainted` in the same write.
import { z } from "zod";
import { noteCardOf, type NoteCard } from "@/core/agent";
import { fold, isNotePath, newNotePath, noteKindOf, parseNote, reconcile, snippetOf, type NoteKind } from "@/core/notes";
import * as pb from "@/core/pocketbase";
import { HttpError } from "@/core/http";
import { listTags, type TagDef } from "@/core/tags";
import { allPdfs } from "./pdfs";
import { semantic, type Near } from "./semantic";

export type Meta = {
  rec: string; path: string; kind: NoteKind; rev: number; text: string; title: string; tags: string[]; pinned: boolean;
  color?: string; updated: number; tainted: boolean;
};

/** What a write hands back: the path and rev, and (a note, not the memory file) its card as it now reads, which the clients draw. */
export type Saved = { saved: string; rev: number; card?: NoteCard } | { error: string };

const cardOf = (path: string, text: string) => (isNotePath(path) ? { card: noteCardOf(path, text) } : {});

const PAGE = 500, TRIES = 3, RRF = 60;
const FIELDS = "id,path,kind,rev,text,title,tags,pinned,color,updated,tainted";

/** PocketBase's `2026-10-30 12:00:00.000Z` as ms. */
export const time = (s: string) => Date.parse(s.replace(" ", "T"));

const metaOf = (r: any): Meta => ({
  rec: r.id, path: r.path, kind: noteKindOf(r.kind), rev: r.rev, text: r.text ?? "", title: r.title || parseNote(r.path, r.text ?? "").title, tags: r.tags ?? [],
  pinned: !!r.pinned, color: r.color || undefined, updated: time(r.updated), tainted: !!r.tainted,
});

/** A search result; `match`: found by its words, its meaning, or both. */
export type Hit = { path: string; title: string; snippet: string; match: "words" | "meaning" | "both" };

export class Notes {
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
    return [...fused.values()].sort((a, b) => b.score - a.score).slice(0, limit).map(({ score: _, ...h }) => h);
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

  /** A new note at a free path. Conflict on a path taken meanwhile: the next free one. */
  async create(title: string, text: (path: string) => string, taint: boolean): Promise<Saved> {
    for (let i = 0; i < TRIES; i++) {
      const path = newNotePath(title, Date.now(), new Set((await this.all()).keys())), body = text(path);
      try {
        const r = await pb.call(this.server, "collections/notes/records", pb.json("POST", { ...pb.noteColumns(path, body), ...(taint ? { tainted: true } : {}) }));
        this.rows = undefined;
        return { saved: r.path, rev: r.rev, ...cardOf(r.path, body) };
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
   *  an edit that adds (`merge` off) is redone on the new text; a whole-file one (`merge`) is merged with the change
   *  made meanwhile, and refused where they overlap. `create`: a missing file starts empty (the memory file). */
  async change(path: string, edit: (text: string) => string, o: { taint?: boolean; merge?: boolean; create?: boolean } = {}): Promise<Saved> {
    let base: { text: string; mine: string } | undefined;
    for (let i = 0; i < TRIES; i++) {
      const cur = await this.read(path);
      if (!cur) {
        if (!o.create) return { error: `No note ${path}: it was deleted meanwhile.` };
        const first = edit("");
        try {
          const r = await pb.call(this.server, "collections/notes/records", pb.json("POST", { ...pb.noteColumns(path, first), ...(o.taint ? { tainted: true } : {}) }));
          this.rows = undefined;
          return { saved: path, rev: r.rev, ...cardOf(path, first) };
        } catch (e) {
          if (e instanceof pb.Conflict) continue;      // made meanwhile: edit that one
          throw e;
        }
      }
      let next: string;
      if (!o.merge || !base) next = edit(cur.text);
      else {
        const m = reconcile(base.text, base.mine, cur.text);
        if (m == null) return { error: `${path} was changed meanwhile, in the same lines. read_note it again and redo the change.` };
        next = m;
      }
      if (o.merge && !base) base = { text: cur.text, mine: next };
      try {
        const r = await pb.call(this.server, `collections/notes/records/${cur.rec}`,
          pb.json("PATCH", { ...pb.noteColumns(path, next), rev: cur.rev, ...(o.taint ? { tainted: true } : {}) }));
        this.rows = undefined;
        return { saved: path, rev: r.rev, ...cardOf(path, next) };
      } catch (e) {
        if (e instanceof HttpError && e.status === 404) return { error: `No note ${path}: it was deleted meanwhile.` };
        if (!(e instanceof pb.Conflict)) throw e;
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

/** A tag list an agent tool takes, for notes and tasks alike. */
export const TAGS = z.array(z.string().min(1).max(30)).max(10).describe("Only tags list_tags returns (defined in Settings or already on a note). Never invent one");

/** `tags` as the defined names they match (case and tonos ignored), or an error naming the ones no definition or note has. */
export async function definedTags(notes: Notes, tags: string[]): Promise<{ tags: string[] } | { error: string }> {
  const defs = await notes.tags(), out: string[] = [], bad: string[] = [];
  for (const t of tags) {
    const d = defs.find((x) => fold(x.name) === fold(t.trim()));
    if (d) { if (!out.includes(d.name)) out.push(d.name); } else bad.push(t);
  }
  return bad.length
    ? { error: `Not an existing tag: ${bad.join(", ")}. Use only: ${defs.map((d) => d.name).join(", ") || "(none defined)"}.` }
    : { tags: out };
}
