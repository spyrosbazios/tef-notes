// The render process (render.ts starts it, render-job.ts is its protocol): one job at a time off Bun's IPC channel, each
// answered with its result or its error. All of the agent's pdf.js and canvas work is here; OCR's per-PDF child
// (ocr-run.ts) does its own drawing beside it. At low priority: a thumbnail can wait for a chat, never the other way round.
import { setPriority } from "node:os";
import { extractText, getDocumentProxy, renderPageAsImage } from "unpdf";
import { paint } from "./drawing-paint";
import type { Args, Op, Out, Request, Response } from "./render-job";

type Doc = Awaited<ReturnType<typeof getDocumentProxy>>;
const canvasImport = () => import("@napi-rs/canvas");

/** The PDF open for `use`, closed after it: this process outlives every file it is handed. */
async function withPdf<T>(pdf: Uint8Array, use: (doc: Doc) => Promise<T>): Promise<T> {
  const doc = await getDocumentProxy(pdf, { verbosity: 0 });
  try { return await use(doc); } finally { await doc.loadingTask.destroy(); }
}

const handlers: { [K in Op]: (args: Args[K]) => Promise<Out[K]> } = {
  text: ({ pdf }) => withPdf(pdf, async (doc) => (await extractText(doc, { mergePages: false })).text),
  pages: ({ pdf }) => withPdf(pdf, async (doc) => doc.numPages),
  thumb: ({ pdf, width, quality }) =>
    withPdf(pdf, async (doc) => new Uint8Array(await renderPageAsImage(doc, 1, { canvasImport, width, format: "jpeg", quality }))),
  shrink: async ({ jpeg, width }) => {
    const { createCanvas, loadImage } = await canvasImport();
    const img = await loadImage(Buffer.from(jpeg));
    const c = createCanvas(width, Math.max(1, Math.round((img.height * width) / img.width)));
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return new Uint8Array(await c.encode("jpeg", 70));
  },
  drawing: ({ scene }) => paint(scene),
};

const run = <K extends Op>(req: Extract<Request, { op: K }>): Promise<Out[K]> => handlers[req.op as K](req.args as Args[K]);

if (import.meta.main) {
  const send = process.send?.bind(process);
  if (!send) throw new Error("render-child.ts is started by render.ts, with an IPC channel");
  try { setPriority(10); } catch { /* not allowed here: it runs at the agent's priority */ }
  process.on("disconnect", () => process.exit(0));                // the agent is gone: so is this
  process.on("message", (req: Request) => {
    run(req).then(
      (value): Response => ({ id: req.id, ok: true, value }),
      (e: unknown): Response => ({ id: req.id, ok: false, error: e instanceof Error ? e.message : String(e) }),
    ).then(send);
  });
}
