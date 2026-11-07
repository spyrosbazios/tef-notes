// A note's pictures for the agent to look at (read_image, tools.ts): the photos and screenshots attached to it, sent to
// the model as image parts. The chat stores only which picture was read; the bytes are fetched again each time the
// history goes to the model. A picture is someone else's content, like a web page: reading one taints the chat (guard.ts).
import * as pb from "@/core/pocketbase";

export type Image = { rec: string; name: string; file: string };

const TYPES: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };

/** A picture's media type by its name, or undefined for anything that isn't one (a PDF, a drawing's source). */
export const imageType = (name: string): string | undefined => TYPES[/\.(\w+)$/.exec(name)?.[1].toLowerCase() ?? ""];

/** The note's pictures (`note`: its own id, parseNote's). */
export async function imagesOf(server: pb.Server, note: string): Promise<Image[]> {
  return (await pb.photos(server, note)).filter((p) => imageType(p.name)).map(({ rec, name, file }) => ({ rec, name, file }));
}

/** The picture's bytes, base64. */
export async function imageData(server: pb.Server, i: Pick<Image, "rec" | "file">): Promise<string> {
  const res = await fetch(pb.photoUrl(server, i));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer()).toString("base64");
}
