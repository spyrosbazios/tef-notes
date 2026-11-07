// A linked page's summary, for the editor's Summary button (web/src/editor/link-tools.ts over the bridge): the server
// reads the page and asks its model (server/pb_hooks/summary.pb.js). The editor puts the block in the note.
import * as pb from "@/core/pocketbase";
import { HttpError } from "@/core/http";
import { serverOf } from "./keys";

/** The summary block of the page at `url`. */
export async function pageSummary(url: string): Promise<string> {
  const s = serverOf();
  if (!s) throw new Error("Couldn't reach the notes server.");
  return pb.pageSummary(s, url);
}

/** What the owner is told when it couldn't be written: the server's reason, else that it didn't answer. */
export const summaryError = (e: unknown) => (e instanceof HttpError ? pb.clipError(e) : "Couldn't reach the notes server.");
