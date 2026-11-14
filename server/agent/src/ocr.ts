// Scanned PDFs read by OCR. A page with no text of its own (pdfs.ts decides which) is drawn and read by Tesseract in a
// child process (ocr-run.ts), one PDF at a time, and what it read is kept in a sqlite file in TEF_NOTES_DATA: derived
// data, like the search vectors (deleting it costs one re-read). The background reads every stored PDF (pdfs.ts
// `readScans`); a page someone is waiting for (read_attachment) goes first, the background's run set aside for it.
// Which languages: TEF_NOTES_OCR, Tesseract's codes joined by "+" (default "eng"; empty: off). Their data files are
// downloaded once into the data directory, from one pinned commit of tessdata_fast; changing the languages reads every
// scanned page again. What OCR reads is someone else's text, as a PDF's own is: it taints the same way (pdfs.ts).
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { PAGE_MS, type Job } from "./ocr-run";

/** What OCR made of one page: its text and how sure it was of it (0–100); `conf` -1: the page couldn't be read. */
export type Read = { page: number; text: string; conf: number };
/** A stored PDF: `key` names the stored file (`<record>/<file>`, which never changes), `url` is where its bytes are. */
export type Source = { key: string; url: string };
/** Reads `pages` (1-based) of the PDF at `url`, handing each over as it is done; `stop` ends it early. Rejects when the
 *  PDF can't be opened, with `Unready` when it is the reader itself that can't work (no language data yet). */
export type Reader = (url: string, pages: number[], got: (r: Read) => void, stop: AbortSignal) => Promise<void>;
/** The reader can't read anything right now: nothing is held against the PDF it was asked for. */
export class Unready extends Error {}

/** Pages of one PDF to read; `whole`: the background's share of the file, which is settled once it is through. */
type Task = { src: Source; pages: number[]; whole: boolean; done?: () => void };

/** The tables' shape; another is dropped and rebuilt (the rows are derived). */
const SCHEMA = 1;
/** A PDF the reader can't open is tried this many times (PocketBase may only be restarting), then given up on. */
const TRIES = 3;

export class Ocr {
  /** Why the last read failed; "" once one works. */
  problem = "";
  private db: Database;
  private asked: Task[] = [];       // someone is waiting for these
  private rest: Task[] = [];        // the background's
  private running?: { task: Task; stop: AbortController; urgent: boolean };
  private tries = new Map<string, number>();
  private idlers: (() => void)[] = [];

  /** `engine` names the reader and its languages: what another engine read is forgotten, and read again. */
  constructor(private reader: Reader, readonly engine: string, file = ":memory:") {
    this.db = new Database(file, { create: true });
    if ((this.db.query("PRAGMA user_version").get() as { user_version: number }).user_version !== SCHEMA) {
      this.db.run("DROP TABLE IF EXISTS pages");
      this.db.run("DROP TABLE IF EXISTS files");
      this.db.run(`PRAGMA user_version = ${SCHEMA}`);
    }
    this.db.run("CREATE TABLE IF NOT EXISTS pages (key TEXT, page INTEGER, engine TEXT, conf INTEGER, text TEXT, PRIMARY KEY (key, page))");
    // A file here is done with: its scans are read (`error` ""), or it can't be opened (`error` says why).
    this.db.run("CREATE TABLE IF NOT EXISTS files (key TEXT PRIMARY KEY, engine TEXT, error TEXT)");
    this.db.run("DELETE FROM pages WHERE engine != ?", [engine]);
    this.db.run("DELETE FROM files WHERE engine != ?", [engine]);
  }

  /** What was read of the stored file `key`, by page. */
  stored(key: string): Map<number, Read> {
    return new Map((this.db.query("SELECT page, text, conf FROM pages WHERE key = ?").all(key) as Read[]).map((r) => [r.page, r]));
  }

  /** How many pages were read of each file. A file's count grows as its scans come in, which is how the search index
   *  knows to embed its note again (pdfs.ts `allPdfs`). */
  counts(): Map<string, number> {
    const rows = this.db.query("SELECT key, COUNT(*) AS n FROM pages WHERE conf >= 0 GROUP BY key").all() as { key: string; n: number }[];
    return new Map(rows.map((r) => [r.key, r.n]));
  }

  /** Whether the background is done with the file: read, or given up on. */
  settled(key: string): boolean { return this.db.query("SELECT 1 FROM files WHERE key = ?").get(key) !== null; }

  /** Marks the file done with; `error`: why it can't be read at all. */
  settle(key: string, error = "") {
    this.db.run("INSERT OR REPLACE INTO files (key, engine, error) VALUES (?, ?, ?)", [key, this.engine, error]);
  }

  /** Whether the background has the file queued or in hand. */
  queued(key: string): boolean {
    return this.rest.some((t) => t.src.key === key) || (this.running?.task.whole === true && this.running.task.src.key === key);
  }

  /** The background's share of a file: these pages, read when nobody is waiting; the file is settled after them. */
  queue(src: Source, pages: number[]) {
    this.rest.push({ src, pages, whole: true });
    this.pump();
  }

  /** These pages now, ahead of the background. Resolves when they were read, or couldn't be: `stored` tells which. */
  want(src: Source, pages: number[]): Promise<void> {
    return new Promise((done) => { this.asked.push({ src, pages, whole: false, done }); this.pump(); });
  }

  /** Forgets every file but these: a PDF deleted from its note takes what was read of it along. */
  keep(keys: Set<string>) {
    for (const table of ["pages", "files"])
      for (const { key } of this.db.query(`SELECT DISTINCT key FROM ${table}`).all() as { key: string }[])
        if (!keys.has(key)) this.db.run(`DELETE FROM ${table} WHERE key = ?`, [key]);
    this.rest = this.rest.filter((t) => keys.has(t.src.key));
  }

  /** How far it has got: pages read, pages still to read, pages and PDFs that couldn't be, the last failure. */
  status() {
    const count = (sql: string) => (this.db.query(sql).get() as { n: number }).n;
    const tasks = [...this.asked, ...this.rest, ...(this.running ? [this.running.task] : [])];
    const waiting = new Set(tasks.flatMap((t) => t.pages.filter((p) => !this.has(t.src.key, p)).map((p) => `${t.src.key}#${p}`)));
    return {
      read: count("SELECT COUNT(*) AS n FROM pages WHERE conf >= 0"),
      waiting: waiting.size,
      failedPages: count("SELECT COUNT(*) AS n FROM pages WHERE conf < 0"),
      failedPdfs: count("SELECT COUNT(*) AS n FROM files WHERE error != ''"),
      problem: this.problem,
    };
  }

  /** Resolves once nothing is queued or being read. */
  idle(): Promise<void> {
    return this.running || this.asked.length || this.rest.length ? new Promise((done) => this.idlers.push(done)) : Promise.resolve();
  }

  private has(key: string, page: number): boolean {
    return this.db.query("SELECT 1 FROM pages WHERE key = ? AND page = ?").get(key, page) !== null;
  }

  private store(key: string, r: Read) {
    this.db.run("INSERT OR REPLACE INTO pages (key, page, engine, conf, text) VALUES (?, ?, ?, ?, ?)", [key, r.page, this.engine, r.conf, r.text]);
  }

  /** Starts the next task when none runs: what was asked for first. A background run in the way of an asker is stopped,
   *  and what it had left comes first once the asker is served. */
  private pump() {
    const cur = this.running;
    if (cur) { if (!cur.urgent && this.asked.length) cur.stop.abort(); return; }
    const urgent = this.asked.length > 0, task = (urgent ? this.asked : this.rest).shift();
    if (!task) { for (const done of this.idlers.splice(0)) done(); return; }
    const { key, url } = task.src, stop = new AbortController();
    const left = new Set(task.pages.filter((p) => !this.has(key, p)));
    this.running = { task, stop, urgent };
    const end = (failed?: Error) => {
      this.running = undefined;
      if (stop.signal.aborted) this.rest.unshift({ ...task, pages: [...left] });
      else {
        const tries = failed && !(failed instanceof Unready) ? (this.tries.get(key) ?? 0) + 1 : 0;
        this.problem = failed?.message ?? "";
        if (tries) this.tries.set(key, tries); else if (!failed) this.tries.delete(key);
        const over = !failed || tries >= TRIES;                // read, or given up on; else the background's next pass tries again
        if (over) for (const page of left) this.store(key, { page, text: "", conf: -1 });   // never handed over: unreadable
        if (over && task.whole) this.settle(key, failed?.message ?? "");
        task.done?.();
      }
      this.pump();
    };
    const got = (r: Read) => { if (left.delete(r.page)) this.store(key, r); };
    (left.size ? Promise.resolve().then(() => this.reader(url, [...left], got, stop.signal)) : Promise.resolve())
      .then(() => end(), (e: unknown) => end(e instanceof Error ? e : new Error(String(e))));
  }
}

// ---- Tesseract

/** Tesseract's language data as `<code>.traineddata`: tessdata_fast at its 4.1.0 tag (what Debian packages), one commit. */
const TESSDATA = "https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/65727574dfcd264acbb0c3e07860e4e9e9b22185";
/** Every code Tesseract has: where a wrong one sends the owner. */
const CODES = "https://tesseract-ocr.github.io/tessdoc/Data-Files-in-different-versions.html";
const ENGINE = "tesseract-fast-4.1.0";

/** TEF_NOTES_OCR as Tesseract's language codes, in the order given (the first is the main one): "ell+eng"; commas and
 *  spaces split too. None: OCR is off. Throws on what can't be a code. */
export function langsOf(raw: string): string[] {
  const codes = [...new Set(raw.toLowerCase().split(/[+,\s]+/).filter(Boolean))];
  const bad = codes.find((c) => !/^[a-z]{3}(_[a-z]+)*$/.test(c));
  if (bad) throw new Error(`TEF_NOTES_OCR: "${bad}" is not a Tesseract language code (eng, ell, deu, chi_sim… all of them: ${CODES})`);
  return codes;
}

/** A language Tesseract doesn't have: no retry will find it. */
class NoLanguage extends Unready {}

/** The language's data in `dir`, downloaded when it isn't there yet. */
async function fetchLang(dir: string, lang: string) {
  const path = join(dir, `${lang}.traineddata`);
  if (await Bun.file(path).exists()) return;
  const res = await fetch(`${TESSDATA}/${lang}.traineddata`).catch((e: unknown) => { throw new Unready(`Tesseract's ${lang} data couldn't be downloaded: ${(e as Error).message}`); });
  if (res.status === 404) throw new NoLanguage(`Tesseract has no language "${lang}" (all of them: ${CODES})`);
  if (!res.ok) throw new Unready(`Tesseract's ${lang} data couldn't be downloaded: HTTP ${res.status}`);
  await mkdir(dir, { recursive: true });
  await Bun.write(`${path}.part`, res);                        // whole or not at all: a cut download is never taken for the data
  await rename(`${path}.part`, path);
}

/** Tesseract over `langs`, its data in `dir`/tessdata. `ready` has the data there (once: a failed download is tried
 *  again, a language that doesn't exist isn't); `read` is the Reader, through the child (ocr-run.ts). */
export function tesseract(dir: string, langs: string[]): { ready: () => Promise<void>; read: Reader } {
  const data = join(dir, "tessdata");
  let had: Promise<void> | undefined;
  const ready = () => {
    if (had) return had;
    const run = Promise.all(langs.map((l) => fetchLang(data, l))).then(() => {});
    had = run;
    run.catch((e: unknown) => { if (!(e instanceof NoLanguage) && had === run) had = undefined; });
    return run;
  };
  const read: Reader = async (url, pages, got, stop) => {
    await ready();
    if (stop.aborted) return;
    const job: Job = { url, pages, langs: langs.join("+"), data };
    const child = Bun.spawn([process.execPath, join(import.meta.dir, "ocr-run.ts"), JSON.stringify(job)], { stdout: "pipe", stderr: "pipe" });
    const kill = () => child.kill();
    stop.addEventListener("abort", kill);
    const timer = setTimeout(kill, pages.length * PAGE_MS + 60_000);      // the child times each page itself; this is for one that hangs elsewhere
    try {
      const failure = new Response(child.stderr).text();
      const take = (line: string) => {
        if (!line.startsWith('{"page":')) return;               // anything else is a library talking
        const r = JSON.parse(line) as { page: number; text?: string; conf?: number; error?: string };
        if (r.error !== undefined) console.error(`agent: OCR of page ${r.page} failed: ${r.error}`);
        got(r.error === undefined ? { page: r.page, text: r.text ?? "", conf: r.conf ?? 0 } : { page: r.page, text: "", conf: -1 });
      };
      const text = new TextDecoder();
      let buf = "";
      for await (const chunk of child.stdout) {
        buf += text.decode(chunk, { stream: true });
        for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) { take(buf.slice(0, nl)); buf = buf.slice(nl + 1); }
      }
      if ((await child.exited) !== 0 && !stop.aborted) throw new Error((await failure).trim().split("\n").pop() || "the OCR process ended early");
    } finally {
      clearTimeout(timer);
      stop.removeEventListener("abort", kill);
    }
  };
  return { ready, read };
}

// ---- the server's one

type State = { on: true; languages: string[]; ocr: Ocr; ready: () => Promise<void> } | { on: false; why: string };
let state: State | undefined;

/** OCR as this server is set up: on, with its languages, or off and why. */
function setup(): State {
  if (state) return state;
  try {
    const languages = langsOf(process.env.TEF_NOTES_OCR ?? "eng");
    if (!languages.length) return (state = { on: false, why: "TEF_NOTES_OCR is empty" });
    if (!Bun.which("tesseract")) return (state = { on: false, why: "tesseract is not installed" });
    const dir = process.env.TEF_NOTES_DATA ?? "./data";
    mkdirSync(dir, { recursive: true });
    const t = tesseract(dir, languages);
    return (state = { on: true, languages, ready: t.ready, ocr: new Ocr(t.read, `${ENGINE}:${languages.join("+")}`, join(dir, "ocr.sqlite")) });
  } catch (e) {
    return (state = { on: false, why: (e as Error).message });
  }
}

/** The server's OCR, or null when scanned PDFs aren't read here. */
export function ocr(): Ocr | null {
  const s = setup();
  return s.on ? s.ocr : null;
}

/** Tests: a stand-in, or null for none. */
export function useOcr(o: Ocr | null) {
  state = o ? { on: true, languages: [], ocr: o, ready: () => Promise.resolve() } : { on: false, why: "off in tests" };
}

/** Says in the log whether scanned PDFs are read, and fetches the languages' data now: a wrong code shows at start,
 *  not at the first scan. True when OCR is on. */
export function startOcr(): boolean {
  const s = setup();
  if (!s.on) { console.error(`agent: scanned PDFs are not read: ${s.why}`); return false; }
  s.ready().then(
    () => console.error(`agent: scanned PDFs are read by Tesseract (${s.languages.join("+")})`),
    (e: unknown) => { s.ocr.problem = (e as Error).message; console.error(`agent: scanned PDFs can't be read yet: ${s.ocr.problem}`); },
  );
  return true;
}

/** GET /agent/ocr: whether scanned PDFs are read, in which languages, and how far it has got. */
export function ocrRoute(): Response {
  const s = setup();
  return Response.json(s.on ? { on: true, languages: s.languages, ...s.ocr.status() } : { on: false, why: s.why });
}
