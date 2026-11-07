// Search by meaning: every note cut into chunks, each chunk a vector from a small multilingual embedding model that
// runs here, on the CPU (no key, nothing leaves the host), so a Greek question finds an English note and "the car"
// finds "Toyota service". search_notes fuses it with the word search (notes.ts `search`) by reciprocal rank.
// The vectors are derived data: a sqlite file in TEF_NOTES_DATA (the agent's volume) keeps a restart from re-embedding
// every note; deleting it costs one re-embed. A note is re-embedded when its title, body or PDFs changed (a hash).
// A note's PDFs are embedded with it (their first MAX_PAGES pages; a scanned one has no text). A PDF is someone else's
// text (pdfs.ts), so a match inside one hands back no snippet of it: only its name, and read_attachment, which taints.
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseNote } from "@/core/notes";
import type { Meta } from "./notes";

/** MIT, 8M active parameters, 100+ languages, mean-pooled 384-dim vectors (its 1_Pooling config). */
export const MODEL = "hotchpotch/bekko-embedding-v1-a8m";
const CHUNK = 1000, MAX_CHUNKS = 40, MAX_PAGES = 50, BATCH = 16;
/** The table's shape; another is dropped and rebuilt (the rows are derived). */
const SCHEMA = 2;
/** What counts as near, measured on real notes: a related note scores ~0.28–0.40, an unrelated one up to ~0.24, so
 *  nothing below FLOOR, and nothing further than SPREAD below the best match (a weak best keeps its weak neighbours out). */
const FLOOR = 0.22, SPREAD = 0.08;

export type Embed = (texts: string[]) => Promise<Float32Array[]>;
export type Near = { path: string; score: number; snippet: string };
/** A note's attached PDF: `key` names the stored file (a new upload is a new key), `pages` its text, read on demand. */
export type Doc = { path: string; key: string; name: string; pages: () => Promise<string[]> };

/** The model, loaded on first use (downloaded once into the data directory). */
function modelEmbed(dir: string): Embed {
  let fe: Promise<(t: string[], o: object) => Promise<{ tolist(): number[][] }>> | undefined;
  return async (texts) => {
    fe ??= (async () => {
      const t = await import("@huggingface/transformers");
      t.env.cacheDir = join(dir, "models");
      return (await t.pipeline("feature-extraction", MODEL, { dtype: "fp32" })) as never;
    })();
    const out = await (await fe)(texts, { pooling: "mean", normalize: true });
    return out.tolist().map((v) => Float32Array.from(v));
  };
}

/** A note's body in pieces of about CHUNK characters, cut at blank lines and before headings; each embedded with its title. */
export function chunks(title: string, body: string): string[] {
  const paras = body.split(/\n\s*\n|\n(?=#{1,6} )/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  let cur = "";
  for (const p of paras) {
    for (let i = 0; i < p.length; i += CHUNK) {
      const piece = p.slice(i, i + CHUNK);
      if (cur && (cur.length + piece.length > CHUNK || (piece.startsWith("#") && cur.length > CHUNK / 3))) { out.push(cur); cur = ""; }
      cur = cur ? `${cur}\n\n${piece}` : piece;
    }
  }
  if (cur) out.push(cur);
  if (!out.length) out.push("");
  return out.slice(0, MAX_CHUNKS).map((c) => (c ? `${title}\n\n${c}` : title));
}

const dot = (a: Float32Array, b: Float32Array) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!; return s; };
const snippet = (c: string) => { const s = c.replace(/\s+/g, " ").trim(); return s.length > 160 ? `${s.slice(0, 160)}…` : s; };

/** A note's chunks: `srcs[i]` is "" for the note's own text, else the PDF's name. */
type Entry = { hash: string; texts: string[]; srcs: string[]; vecs: Float32Array[] };

export class Semantic {
  private mem = new Map<string, Entry>();
  private lock: Promise<unknown> = Promise.resolve();
  private db: Database;

  constructor(private embed: Embed, file = ":memory:") {
    this.db = new Database(file, { create: true });
    if ((this.db.query("PRAGMA user_version").get() as { user_version: number }).user_version !== SCHEMA) {
      this.db.run("DROP TABLE IF EXISTS chunks");
      this.db.run(`PRAGMA user_version = ${SCHEMA}`);
    }
    this.db.run("CREATE TABLE IF NOT EXISTS chunks (path TEXT, hash TEXT, model TEXT, i INTEGER, src TEXT, text TEXT, vec BLOB, PRIMARY KEY (path, i))");
    this.db.run("DELETE FROM chunks WHERE model != ?", [MODEL]);
    for (const r of this.db.query("SELECT path, hash, src, text, vec FROM chunks ORDER BY path, i").all() as { path: string; hash: string; src: string; text: string; vec: Uint8Array }[]) {
      const e = this.mem.get(r.path) ?? { hash: r.hash, texts: [], srcs: [], vecs: [] };
      e.texts.push(r.text);
      e.srcs.push(r.src);
      e.vecs.push(new Float32Array(r.vec.buffer.slice(r.vec.byteOffset, r.vec.byteOffset + r.vec.byteLength)));
      this.mem.set(r.path, e);
    }
  }

  /** Brings the vectors up to the notes as listed and their PDFs: embeds what changed, forgets what's gone. One sync at a time. */
  sync(notes: Meta[], docs: Doc[] = []): Promise<void> {
    const run = this.lock.then(() => this.syncNow(notes, docs));
    this.lock = run.catch(() => {});
    return run;
  }

  private async syncNow(notes: Meta[], docs: Doc[]) {
    const live = new Map(notes.filter((n) => n.path.startsWith("notes/")).map((n) => [n.path, n]));
    for (const path of [...this.mem.keys()]) if (!live.has(path)) this.forget(path);
    const attached = Map.groupBy(docs, (d) => d.path);
    for (const n of live.values()) {
      const body = parseNote(n.path, n.text).body, pdfs = (attached.get(n.path) ?? []).sort((a, b) => a.key.localeCompare(b.key));
      const hash = Bun.hash(`${n.title}\0${body}\0${pdfs.map((d) => d.key).join("\0")}`).toString(36);
      if (this.mem.get(n.path)?.hash === hash) continue;
      const texts = chunks(n.title, body), srcs = texts.map(() => "");
      for (const d of pdfs) {
        let pages: string[];
        try { pages = await d.pages(); } catch (e) { console.error(`agent: indexing ${d.name} failed: ${(e as Error).message}`); continue; }
        const text = pages.slice(0, MAX_PAGES).join("\n\n").trim();
        if (!text) continue;                                  // scanned: no text layer
        for (const c of chunks(`${n.title} — ${d.name}`, text)) { texts.push(c); srcs.push(d.name); }
      }
      const vecs: Float32Array[] = [];
      for (let i = 0; i < texts.length; i += BATCH) vecs.push(...(await this.embed(texts.slice(i, i + BATCH))));
      this.store(n.path, { hash, texts, srcs, vecs });
    }
  }

  private forget(path: string) {
    this.mem.delete(path);
    this.db.run("DELETE FROM chunks WHERE path = ?", [path]);
  }

  private store(path: string, e: Entry) {
    this.db.transaction(() => {
      this.db.run("DELETE FROM chunks WHERE path = ?", [path]);
      const ins = this.db.prepare("INSERT INTO chunks (path, hash, model, i, src, text, vec) VALUES (?, ?, ?, ?, ?, ?, ?)");
      e.texts.forEach((t, i) => ins.run(path, e.hash, MODEL, i, e.srcs[i]!, t, new Uint8Array(e.vecs[i]!.buffer)));
    })();
    this.mem.set(path, e);
  }

  /** The notes nearest `query` in meaning, best chunk per note, nearest first; within FLOOR and SPREAD. */
  async near(notes: Meta[], query: string, limit: number, docs: Doc[] = []): Promise<Near[]> {
    await this.sync(notes, docs);
    const [q] = await this.embed([query]);
    const out: Near[] = [];
    for (const [path, e] of this.mem) {
      let best = -1, at = 0;
      e.vecs.forEach((v, i) => { const s = dot(q!, v); if (s > best) { best = s; at = i; } });
      const src = e.srcs[at]!;
      if (best >= FLOOR) out.push({ path, score: best, snippet: src ? `(matched inside its PDF ${JSON.stringify(src)}: read_attachment to read it)` : snippet(e.texts[at]!) });
    }
    out.sort((a, b) => b.score - a.score);
    return out.filter((n) => n.score >= out[0]!.score - SPREAD).slice(0, limit);
  }
}

let shared: Semantic | undefined;

/** The agent's one index, over the model, cached in TEF_NOTES_DATA (default ./data). */
export function semantic(): Semantic {
  if (!shared) {
    const dir = process.env.TEF_NOTES_DATA ?? "./data";
    mkdirSync(dir, { recursive: true });
    shared = new Semantic(modelEmbed(dir), join(dir, "semantic.sqlite"));
  }
  return shared;
}

/** Tests: an index over a stand-in model, in memory. */
export function useSemantic(s: Semantic) { shared = s; }
