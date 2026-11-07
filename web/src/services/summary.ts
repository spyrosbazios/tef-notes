// A linked page's summary, for a note's Summary button (src/editor/link-tools.ts): the server reads the page and asks its
// model (server/pb_hooks/summary.pb.js). The editor puts the block in the note.
import { AxiosError } from "axios";
import { api } from "./api";

/** The summary block of the page at `url`. Throws with the server's reason when it couldn't be written. */
export async function summarize(url: string): Promise<string> {
  try {
    const { data } = await api.post<{ summary: string }>("tefnotes/summary", { url }, { timeout: 60_000 });
    return data.summary;
  } catch (e) {
    const reason = e instanceof AxiosError && typeof e.response?.data?.error === "string" ? e.response.data.error : null;
    throw new Error(reason ?? "The summary couldn't be written.");
  }
}
