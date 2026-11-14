// The OCR child (ocr.ts runs it, one per PDF): opens the PDF, draws each page asked for and has Tesseract read it, a
// line of JSON per page on stdout as it is done. A process of its own, at low priority: drawing a scan is seconds of
// CPU that would hold up every chat in the agent's own, and ending the process gives its memory back.
import { setPriority } from "node:os";
import { getDocumentProxy, renderPageAsImage } from "unpdf";

/** What the child is told, as its one argument: the PDF, its pages to read (1-based), Tesseract's languages ("ell+eng")
 *  and the directory their data is in. */
export type Job = { url: string; pages: number[]; langs: string; data: string };

/** The longest Tesseract may take over one page. */
export const PAGE_MS = 120_000;
/** A scan is drawn at 200 dots per inch of its page (a PDF's unit is 1/72 inch), its longer side at most LONG pixels:
 *  some scanners make the page as large as the picture's pixels. Measured on a 4-core N100 (2026-11-14): drawn half as
 *  large again, Tesseract was slower and read two pages in fourteen much worse. */
const DPI = 200, LONG = 2600;

/** Tesseract's TSV as the page's text, a line per line it found, and how sure it was: the mean of its words' confidence.
 *  Throws on anything else it may have printed: a page that reads as empty must be one Tesseract found empty. */
export function fromTsv(tsv: string): { text: string; conf: number } {
  if (!tsv.startsWith("level\t")) throw new Error("Tesseract didn't answer with its TSV");
  const lines: string[] = [];
  let at = "", sum = 0, words = 0;
  for (const row of tsv.split("\n")) {
    const c = row.split("\t");                                // level page block par line word left top width height conf text
    const word = c.slice(11).join(" ").trim();
    if (c[0] !== "5" || !word) continue;                      // 5: a word
    const line = `${c[2]}.${c[3]}.${c[4]}`;
    if (line === at) lines[lines.length - 1] += ` ${word}`; else { lines.push(word); at = line; }
    sum += Number(c[10]);
    words++;
  }
  return { text: lines.join("\n"), conf: words ? Math.round(sum / words) : 0 };
}

if (import.meta.main) {
  let reading: Bun.Subprocess | undefined;
  process.on("SIGTERM", () => { reading?.kill(); process.exit(143); });      // set aside by ocr.ts: Tesseract goes with it
  try {
    try { setPriority(10); } catch { /* not allowed here: it runs at the agent's priority */ }
    const job = JSON.parse(process.argv[2] ?? "") as Job;
    const res = await fetch(job.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const doc = await getDocumentProxy(new Uint8Array(await res.arrayBuffer()), { verbosity: 0 });
    for (const page of job.pages) {
      let out: object;
      try {
        const { width, height } = (await doc.getPage(page)).getViewport({ scale: 1 });
        const png = await renderPageAsImage(doc, page, { canvasImport: () => import("@napi-rs/canvas"), scale: Math.min(DPI / 72, LONG / Math.max(width, height)) });
        // TSV by its variable, not Tesseract's `tsv` preset: presets are files in the data directory, and ours holds languages only.
        const proc = Bun.spawn(["tesseract", "stdin", "stdout", "--tessdata-dir", job.data, "-l", job.langs, "-c", "tessedit_create_tsv=1"], {
          stdin: png, stdout: "pipe", stderr: "pipe", env: { ...process.env, OMP_THREAD_LIMIT: "1" },   // one thread: the other cores are the agent's
        });
        reading = proc;
        const timer = setTimeout(() => proc.kill(), PAGE_MS);
        const [tsv, failure, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
        clearTimeout(timer);
        if (code !== 0) throw new Error(failure.trim().split("\n").pop() || `Tesseract ended with ${code}`);
        out = { page, ...fromTsv(tsv) };
      } catch (e) {
        out = { page, error: (e as Error).message };
      }
      process.stdout.write(`${JSON.stringify(out)}\n`);
    }
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    process.exit(1);
  }
}
