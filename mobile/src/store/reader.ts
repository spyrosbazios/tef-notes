// A linked page read as an article: the server's `GET /agent/reader` (core/reader.ts has the shape and the reading of
// its answer). Kept per address in react-query for the session; a failure is not kept, so reopening tries again.
import { useQuery } from "@tanstack/react-query";
import { HttpError, getJson } from "@/core/http";
import { agentUrl } from "@/core/pocketbase";
import { articleOf, readerPath, type Article } from "@/core/reader";
import { useKeys } from "./keys";

const NO_SERVER = "Couldn't reach the notes server.";

/** What the owner is told when the page can't be read: the server's own reason, else that it didn't answer. */
export const readerError = (e: unknown) => (e instanceof HttpError && typeof e.body?.message === "string" ? e.body.message : NO_SERVER);

async function fetchArticle(server: string | undefined, url: string): Promise<Article> {
  if (!server) throw new Error(NO_SERVER);
  const article = articleOf(await getJson(agentUrl({ url: server }, readerPath(url)), {}, 1, 30_000));
  if (!article) throw new HttpError(422, "No article", undefined, { message: "There's no article to show on that page." });
  return article;
}

export function useArticle(url: string) {
  const server = useKeys((s) => s.keys.server);
  return useQuery({
    queryKey: ["reader", server, url], queryFn: () => fetchArticle(server, url), staleTime: Infinity, retry: false,
  });
}
