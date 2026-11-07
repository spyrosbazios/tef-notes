// A linked page as an article (Reader view), from the agent's reader route (contract: core/reader.ts): the server fetches
// the page and finds the article, since a browser can't read another site (CORS).
import { articleOf, readerPath, type Article } from "@/core/reader";
import { api } from "./api";

/** The article at `url`. Throws when there is none (the server's message says why) or the server can't be asked. */
export async function read(url: string): Promise<Article> {
  const a = articleOf((await api.get(`/agent/${readerPath(url)}`, { baseURL: "", timeout: 40_000 })).data);
  if (!a) throw new Error("No article found on that page.");
  return a;
}
