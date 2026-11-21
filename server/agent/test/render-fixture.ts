// A stand-in render process for render.test.ts, speaking render.ts's protocol; what it does is told by the first byte of
// the job's bytes: 0 answers (with the byte count), 1 never answers, 2 dies, 3 works its CPU for 300 ms and answers.
import type { Request, Response } from "../src/render-job";

const send = process.send!.bind(process);
process.on("disconnect", () => process.exit(0));
process.on("message", async (req: Request) => {
  const bytes = req.op === "pages" ? req.args.pdf : req.op === "shrink" ? req.args.jpeg : new Uint8Array();
  switch (bytes[0]) {
    case 1: return;
    case 2: process.exit(1); break;
    case 3: for (const end = Date.now() + 300; Date.now() < end;); break;
  }
  const res: Response = req.op === "pages" ? { id: req.id, ok: true, value: bytes.length } : { id: req.id, ok: true, value: bytes };
  send(res);
});
