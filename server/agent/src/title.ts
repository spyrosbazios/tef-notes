// A title for a note made from shared files alone (POST /agent/title, called by PocketBase's clip route,
// server/pb_hooks/clip.pb.js): one short model call on the default model. A PDF is titled from its first pages' text (what
// OCR read of a scan, waited for a little); a photo or screenshot by the model looking at it. The PDF comes first, as the
// clip route's own fallback puts a PDF's name over the day's "Photos". Any failure, no key, or a model that takes no images
// answers `{ title: null }`, and the route keeps the title it had: titling never fails a save. This route writes nothing:
// the title is a model's reading of someone else's file, set on the note by the clip route (`retitle`), whose write marks
// the note `tainted` like the rest of that clip's.
import { generateText, type ModelMessage } from "ai";
import { z } from "zod";
import { isPdf } from "@/core/photos";
import * as pb from "@/core/client/pocketbase";
import { cleanTitle, TITLE_MAX } from "@/core/share";
import type { Server } from "@/core/server-urls";
import { imageData, imageType } from "./images";
import { DEFAULT, model, sees } from "./models";
import { pages, readNow } from "./pdfs";

/** The first pages' text the model is given, at most. */
const TEXT_CHARS = 3000, TEXT_PAGES = 2;
/** How long a scanned first page is waited for, and the model call; the clip route waits for this route a little longer. */
const OCR_MS = 20_000, MODEL_MS = 20_000;

const INSTRUCTIONS = `You title notes. Answer with only the title: at most ${TITLE_MAX} characters, in the language of the content, no quotes, no full stop at the end. Name what it is specifically (the document, the place, the thing, who or what it is from), not its format: never "Photo of", "Screenshot of", "Document", "Image".`;

const Body = z.object({ note: z.string().min(1).max(200) });

/** The question for the note's files, or null when there is nothing a model could title it from. */
async function question(server: Server, note: string): Promise<ModelMessage[] | null> {
  const files = await pb.attachments.list(server, note);
  const pdf = files.find((f) => isPdf(f.name)), image = files.find((f) => imageType(f.name));
  if (pdf) {
    let ps = await pages(server, pdf);
    if (ps.slice(0, TEXT_PAGES).some((p) => p.scan === "wait")) {
      await readNow(server, pdf, 1, TEXT_PAGES, OCR_MS);
      ps = await pages(server, pdf);
    }
    const text = ps.slice(0, TEXT_PAGES).map((p) => p.text).join("\n\n").trim().slice(0, TEXT_CHARS);
    if (!text) return null;
    return [{ role: "user", content: `A PDF named "${pdf.name}". Its first pages:\n\n${text}\n\nTitle it.` }];
  }
  if (image && sees(DEFAULT)) {
    const data = await imageData(server, image);
    return [{ role: "user", content: [
      { type: "file", mediaType: imageType(image.name)!, data: { type: "data", data } },
      { type: "text", text: "A photo or screenshot that was shared. Title it." },
    ] }];
  }
  return null;
}

/** The title for the note `note` (its own id), or null. `pick`: the model; the tests hand in a mock. */
export async function titleOf(server: Server, note: string, pick: typeof model = model): Promise<string | null> {
  try {
    const messages = await question(server, note);
    if (!messages) return null;
    const m = await pick(DEFAULT);
    const r = await generateText({
      model: m.model, providerOptions: m.providerOptions, instructions: INSTRUCTIONS, messages,
      // no thinking: a thinking model spent a small budget on it and wrote no title (DeepSeek Flash, 2026-11-19); the
      // headroom is for a provider that thinks anyway
      reasoning: "none", maxOutputTokens: 1000, abortSignal: AbortSignal.timeout(MODEL_MS),
    });
    const t = cleanTitle(r.text);
    if (!t) console.error(`agent: titling ${note}: the model wrote no title (${r.finishReason})`);
    return t || null;
  } catch (e) {
    console.error(`agent: titling ${note} failed: ${(e as Error).message}`);
    return null;
  }
}

export async function titleRoute(req: Request, server: Server, pick: typeof model = model): Promise<Response> {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ message: "Bad request: note" }, { status: 400 });
  return Response.json({ title: await titleOf(server, parsed.data.note, pick) });
}
