// Files coming into the app as notes (core `importNotes`, shared with the CLI's `tefnotes import`): a picked folder of
// Markdown, or a zip such as Settings → Export makes. Paths are the folder's own: a picked folder's name, or a zip's
// single top folder, is dropped so links between its files resolve as they do on disk.
import { strFromU8, unzipSync } from "fflate";
import type { Source } from "@/core/import";

/** The common first folder of every path, dropped; none when they don't share one. */
function rooted(paths: string[]): (p: string) => string {
  const first = paths[0]?.split("/")[0];
  return first && paths.every((p) => p.startsWith(`${first}/`)) ? (p) => p.slice(first.length + 1) : (p) => p;
}

const hidden = (p: string) => p.split("/").some((s) => s.startsWith(".") || s === "node_modules" || s === "__MACOSX");

/** A folder picked with `webkitdirectory`: each file's path under it. */
export function folderSource(files: File[]): Source {
  const strip = rooted(files.map((f) => f.webkitRelativePath || f.name));
  const by = new Map(files.map((f) => [strip(f.webkitRelativePath || f.name), f] as const).filter(([p]) => !hidden(p)));
  const get = (p: string) => by.get(p) ?? Promise.reject(new Error(`${p}: not in the folder`));
  return { paths: [...by.keys()], text: async (p) => (await get(p)).text(), blob: async (p) => get(p) };
}

/** A zip's files, unpacked in memory. */
export async function zipSource(zip: File): Promise<Source> {
  const all = Object.entries(unzipSync(new Uint8Array(await zip.arrayBuffer()))).filter(([p]) => !p.endsWith("/"));
  const strip = rooted(all.map(([p]) => p));
  const by = new Map(all.map(([p, d]) => [strip(p), d] as const).filter(([p]) => !hidden(p)));
  const get = (p: string) => by.get(p) ?? (() => { throw new Error(`${p}: not in the zip`); })();
  return { paths: [...by.keys()], text: async (p) => strFromU8(get(p)), blob: async (p) => new Blob([get(p) as Uint8Array<ArrayBuffer>]) };
}
