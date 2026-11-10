// attach_file: a photo or PDF the owner attached in the chat filed into a note, as the app's own upload would: an
// `attachments` record under the note's id and a line in its body pointing at it. The bytes come from the chat's file part
// (its data URL); the model only names the file. Someone else's content: the write is always marked tainted.
import { tool } from "ai";
import { z } from "zod";
import type { Attached } from "@/core/assistant";
import { parseNote, serializeNote, withBody } from "@/core/notes";
import { fileMarkdown, PDF, pdfName, photoMarkdown, photoName } from "@/core/photos";
import * as pb from "@/core/pocketbase";
import { localDay } from "@/core/time";
import { definedTags, TAGS, type Notes } from "./notes";
import { checkWrite } from "./tools";

export const ATTACH = z.object({
  file: z.string().min(1).describe("The attached file's name, as the <attached> block lists it"),
  path: z.string().optional().describe("The note to add it to: notes/<file>.md. Omit, with a title, for a new note"),
  title: z.string().min(1).max(80).optional().describe("A new note's title, when no note fits"),
  text: z.string().optional().describe("A line or two above the file: what it is, in the owner's language"),
  tags: TAGS.optional().describe("A new note's tags"),
});
export type AttachInput = z.infer<typeof ATTACH>;

/** The file's bytes from its data URL. */
export function bytesOf(url: string): Uint8Array | null {
  const m = /^data:[^;,]*(;base64)?,(.*)$/s.exec(url);
  if (!m) return null;
  return m[1] ? Uint8Array.from(Buffer.from(m[2], "base64")) : new TextEncoder().encode(decodeURIComponent(m[2]));
}

/** Why the call can't go ahead, or null: checked before the owner is asked, so a bad one goes back to the agent. */
export async function attachProblem(notes: Notes, files: readonly Attached[], i: AttachInput): Promise<string | null> {
  if (!files.some((f) => f.name === i.file)) return files.length
    ? `No attached file "${i.file}". Attached: ${files.map((f) => f.name).join(", ")}.`
    : "Nothing is attached in this chat.";
  if (!!i.path === !!i.title) return "Pass either path (an existing note) or title (a new one).";
  return i.path ? checkWrite(notes, i.path) : null;
}

export function fileTools(notes: Notes, files: readonly Attached[]) {
  return {
    attach_file: tool({
      description: "File a photo or PDF the owner attached in this chat into a note: the file is saved to the note and shown in it, as if they had added it in the app, with your line on what it is above it. Into a note that fits (path), or a new one (title, tags from list_tags). The owner confirms. Read it first: you have it in the message.",
      inputSchema: ATTACH,
      execute: async (i) => {
        const bad = await attachProblem(notes, files, i);
        if (bad) return { error: bad };
        const f = files.find((x) => x.name === i.file)!, bytes = bytesOf(f.url);
        if (!bytes) return { error: `${f.name} couldn't be read.` };
        const t = i.tags && await definedTags(notes, i.tags);
        if (t && "error" in t) return t;
        const text = i.text?.trim() ?? "";

        // A new note is made first, with the line, so the file has an id to go under
        let path = i.path!;
        if (i.title) {
          const meta = { title: i.title.trim(), created: localDay(), ...(t ? { tags: t.tags } : {}) };
          const made = await notes.create(meta.title, () => serializeNote(meta, text ? `${text}\n` : ""), true);
          if ("error" in made) return made;
          path = made.saved;
        }
        const cur = await notes.read(path);
        if (!cur) return { error: `No note ${path}.` };
        const id = parseNote(path, cur.text).id;
        const taken = new Set((await pb.photos(notes.server, id)).map((p) => p.name));
        const pdf = f.mediaType === PDF, name = pdf ? pdfName(f.name, taken) : photoName(Date.now(), taken);
        let rec: string;
        try { rec = (await pb.upload(notes.server, id, name, new Blob([bytes as Uint8Array<ArrayBuffer>], { type: pdf ? PDF : "image/jpeg" }))).rec; }
        catch (e) { return { error: `Couldn't save ${f.name}: ${(e as Error).message}` }; }

        const line = pdf ? fileMarkdown(id, name, f.name) : photoMarkdown(id, [name]);
        const add = i.title ? line : [text, line].filter(Boolean).join("\n");
        const saved = await notes.change(path, (file) => {
          const n = parseNote(path, file);
          return withBody(file, n, `${n.body.trimEnd()}${n.body.trim() ? "\n\n" : ""}${add}\n`);
        }, { taint: true });
        if ("error" in saved) await pb.removePhoto(notes.server, rec).catch(() => {});
        return saved;
      },
    }),
  };
}
