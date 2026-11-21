// OCR's books and queue (src/ocr.ts) over a stand-in reader: what is read is kept, an asker goes ahead of the
// background, a PDF that can't be opened is given up on after a few tries, another engine reads everything again.
// Tesseract itself isn't run here: its TSV is read from a sample (ocr-run.ts `fromTsv`).
import { afterAll, describe, expect, it } from "bun:test";
import { BACKOFF_MS, langsOf, languagesOf, Ocr, Unready, type Read, type Reader } from "../src/ocr";
import { fromTsv } from "../src/ocr-run";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "ocr-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const A = { key: "r1/a.pdf", url: "http://x/a" }, B = { key: "r2/b.pdf", url: "http://x/b" };
const page = (n: number): Read => ({ page: n, text: `text ${n}`, conf: 80 });
const all: Reader = async (_url, pages, got) => { for (const p of pages) got(page(p)); };

describe("Ocr", () => {
  it("keeps what the reader hands over, and reads a page once", async () => {
    const calls: number[][] = [];
    const o = new Ocr(async (url, pages, got, stop) => { calls.push(pages); await all(url, pages, got, stop); }, "e");
    await o.want(A, [2, 1]);
    await o.want(A, [1, 2, 3]);
    expect(calls).toEqual([[2, 1], [3]]);
    expect([...o.stored(A.key).values()]).toEqual([page(1), page(2), page(3)]);
    expect(o.counts()).toEqual(new Map([[A.key, 3]]));
  });

  it("settles a file once the background has read its share, at once when it has no scans", async () => {
    const o = new Ocr(all, "e");
    o.queue(A, [1, 2]);
    o.queue(B, []);
    expect(o.queued(A.key)).toBe(true);
    await o.idle();
    expect([o.settled(A.key), o.settled(B.key), o.queued(A.key)]).toEqual([true, true, false]);
    expect(o.status()).toEqual({ read: 2, waiting: 0, failedPages: 0, failedPdfs: 0, problem: "" });
  });

  it("serves an asker ahead of the background: its run is set aside, and what it had left is read after", async () => {
    const order: string[] = [];
    const slow: Reader = async (url, pages, got, stop) => {
      for (const p of pages) {
        await Bun.sleep(5);
        if (stop.aborted) return;
        order.push(`${url.slice(-1)}${p}`);
        got(page(p));
      }
    };
    const o = new Ocr(slow, "e");
    o.queue(A, [1, 2, 3, 4]);
    await Bun.sleep(8);                                        // the background is on page 2
    await o.want(B, [1]);
    expect(order).toEqual(["a1", "b1"]);
    await o.idle();
    expect(order).toEqual(["a1", "b1", "a2", "a3", "a4"]);
    expect(o.settled(A.key)).toBe(true);
  });

  it("marks a page the reader didn't hand over as unreadable", async () => {
    const o = new Ocr(async (_url, pages, got) => { got(page(pages[0]!)); }, "e");
    await o.want(A, [1, 2]);
    expect(o.stored(A.key).get(2)).toEqual({ page: 2, text: "", conf: -1 });
    expect(o.status()).toMatchObject({ read: 1, failedPages: 1 });
  });

  it("tries a PDF that won't open three times, then gives up on it and says why", async () => {
    let calls = 0;
    const o = new Ocr(async () => { calls++; throw new Error("HTTP 502"); }, "e");
    for (let i = 0; i < 2; i++) {
      o.queue(A, [1]);
      await o.idle();
      expect([o.settled(A.key), o.stored(A.key).size, o.problem]).toEqual([false, 0, "HTTP 502"]);   // the next pass tries again
    }
    o.queue(A, [1]);
    await o.idle();
    expect(calls).toBe(3);
    expect(o.settled(A.key)).toBe(true);
    expect(o.status()).toMatchObject({ failedPages: 1, failedPdfs: 1, problem: "HTTP 502" });
  });

  it("holds nothing against a PDF while the reader itself can't work, and tries again once the back-off is over", async () => {
    let ready = false, clock = 0;
    const o = new Ocr(async (url, pages, got, stop) => { if (!ready) throw new Unready("no language data"); await all(url, pages, got, stop); }, "e", ":memory:", () => clock);
    o.queue(A, [1]);
    await o.idle();
    expect([o.settled(A.key), o.stored(A.key).size, o.problem]).toEqual([false, 0, "no language data"]);
    clock += BACKOFF_MS;
    ready = true;
    o.queue(A, [1]);
    await o.idle();
    expect([o.settled(A.key), o.stored(A.key).size, o.problem]).toEqual([true, 1, ""]);
  });

  it("leaves a reader that can't work alone for twice as long each time, up to the cap, not every minute", async () => {
    let calls = 0, clock = 0;
    const o = new Ocr(async () => { calls++; throw new Unready("no language data"); }, "e", ":memory:", () => clock);
    const waits: number[] = [];
    for (let i = 0; i < 9; i++) {
      o.queue(A, [1]);
      await o.idle();
      expect(o.holding()).toBe(true);
      let wait = 0;
      while (o.holding()) { clock += 1000; wait += 1000; }       // the time until it is tried again
      waits.push(wait);
    }
    expect(calls).toBe(9);
    expect(waits).toEqual([1, 2, 4, 8, 16, 32, 60, 60, 60].map((m) => m * 60_000));        // minutes; 60 is BACKOFF_MAX_MS
  });

  it("does nothing while holding: queued files are dropped, askers are let go, later ones ignored", async () => {
    let calls = 0, clock = 0;
    const o = new Ocr(async () => { calls++; throw new Unready("no language data"); }, "e", ":memory:", () => clock);
    o.queue(A, [1]);
    o.queue(B, [1]);                                           // behind A: set aside with it
    await o.idle();
    expect(calls).toBe(1);
    expect(o.queued(B.key)).toBe(false);
    o.queue(B, [1]);
    await o.want(B, [1]);                                      // resolves at once, reads nothing
    await o.idle();
    expect([calls, o.queued(B.key), o.stored(B.key).size]).toEqual([1, false, 0]);
    expect(o.status()).toMatchObject({ waiting: 0, failedPdfs: 0, problem: "no language data" });
  });

  it("starts the back-off over once the reader has worked", async () => {
    let fail = true, calls = 0, clock = 0;
    const o = new Ocr(async (url, pages, got, stop) => { calls++; if (fail) throw new Unready("no data"); await all(url, pages, got, stop); }, "e", ":memory:", () => clock);
    o.queue(A, [1]); await o.idle();
    clock += BACKOFF_MS; o.queue(A, [1]); await o.idle();      // the second failure holds for two minutes
    clock += 2 * BACKOFF_MS; fail = false; o.queue(A, [1]); await o.idle();
    expect([calls, o.holding(), o.settled(A.key)]).toEqual([3, false, true]);
    fail = true;
    o.queue(B, [1]); await o.idle();
    clock += BACKOFF_MS;                                       // the first failure's wait again, not the third's
    expect(o.holding()).toBe(false);
  });

  it("forgets the files it isn't told to keep", async () => {
    const o = new Ocr(all, "e");
    o.queue(A, [1]);
    o.queue(B, [1]);
    await o.idle();
    o.keep(new Set([B.key]));
    expect([o.stored(A.key).size, o.settled(A.key), o.stored(B.key).size, o.settled(B.key)]).toEqual([0, false, 1, true]);
  });

  it("keeps its books across a restart, and reads everything again for another engine", async () => {
    const file = join(dir, "ocr.sqlite");
    const first = new Ocr(all, "tesseract:eng", file);
    first.queue(A, [1]);
    await first.idle();
    const same = new Ocr(all, "tesseract:eng", file);
    expect([same.stored(A.key).size, same.settled(A.key)]).toEqual([1, true]);
    const other = new Ocr(all, "tesseract:ell+eng", file);
    expect([other.stored(A.key).size, other.settled(A.key)]).toEqual([0, false]);
  });
});

describe("TEF_NOTES_OCR", () => {
  it("is Tesseract's codes, joined by + (or commas, or spaces), in the order given", () => {
    expect(langsOf("ell+eng")).toEqual(["ell", "eng"]);
    expect(langsOf(" DEU, eng  chi_sim+deu ")).toEqual(["deu", "eng", "chi_sim"]);
    expect(langsOf("")).toEqual([]);
  });

  it("drops a code Tesseract has no data for and says which, keeping the others in order", () => {
    expect(languagesOf("ell+eng")).toEqual({ use: ["ell", "eng"], ignored: [] });
    expect(languagesOf("ell+xyz+eng+gre")).toEqual({ use: ["ell", "eng"], ignored: ["xyz", "gre"] });
    expect(languagesOf("xyz")).toEqual({ use: [], ignored: ["xyz"] });
    expect(languagesOf("")).toEqual({ use: [], ignored: [] });
    expect(() => languagesOf("greek!")).toThrow("is not a Tesseract language code");
  });

  it("refuses what can't be a code", () => {
    expect(() => langsOf("greek")).toThrow('TEF_NOTES_OCR: "greek" is not a Tesseract language code');
    expect(() => langsOf("eng+../x")).toThrow("is not a Tesseract language code");
  });
});

describe("Tesseract's TSV", () => {
  const row = (level: number, block: number, par: number, line: number, word: number, conf: number, text: string) =>
    [level, 1, block, par, line, word, 0, 0, 10, 10, conf, text].join("\t");

  it("becomes the page's lines and the mean of its words' confidence", () => {
    const tsv = [
      "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
      row(1, 0, 0, 0, 0, -1, ""), row(4, 1, 1, 1, 0, -1, ""),
      row(5, 1, 1, 1, 1, 90, "Ενοίκιο"), row(5, 1, 1, 1, 2, 70, "900"),
      row(5, 1, 1, 2, 1, 80, "Deposit"), row(5, 1, 1, 2, 2, 95, " "),
      row(5, 2, 1, 1, 1, 60, "Signed"),
      "",
    ].join("\n");
    expect(fromTsv(tsv)).toEqual({ text: "Ενοίκιο 900\nDeposit\nSigned", conf: 75 });
  });

  it("is an empty page when Tesseract found no words", () => {
    expect(fromTsv("level\tpage_num\n1\t1\t0\t0\t0\t0\t0\t0\t10\t10\t-1\t\n")).toEqual({ text: "", conf: 0 });
  });

  it("is refused when it isn't TSV at all, so plain text is never taken for an empty page", () => {
    expect(() => fromTsv("Ενοίκιο 900\n")).toThrow("Tesseract didn't answer with its TSV");
  });
});
