// Reader view's contract: a linked page read as an article, its clutter (menus, ads, comments) gone, for the web app's
// reader (web/src/components/reader.tsx). The agent's `GET /agent/reader?url=` answers it
// (server/agent/src/reader.ts, whose answer the compiler holds to `Article`): PocketBase fetches the page through the
// link-preview guard, Defuddle finds the article and writes it as markdown. Here: the shape, the route, and the one
// defensive reading of the answer.

/** An article. `markdown` is the body; the rest is "" when the page doesn't say. `url` is where the page ended up. */
export type Article = {
  url: string;
  title: string;
  author: string;
  site: string;
  published: string;
  image: string;
  markdown: string;
  words: number;
};

/** The route under the agent's `/agent/`, for `url`. */
export const readerPath = (url: string) => `reader?url=${encodeURIComponent(url)}`;

const str = (v: unknown) => (typeof v === "string" ? v : "");
const web = (v: unknown) => (typeof v === "string" && /^https:\/\//i.test(v) ? v : "");

/** The server's answer as an Article; null when it holds no article to show. */
export function articleOf(x: unknown): Article | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const markdown = str(o.markdown).trim();
  if (!markdown || !/^https?:\/\//i.test(str(o.url))) return null;
  return {
    url: str(o.url), title: str(o.title), author: str(o.author), site: str(o.site), published: str(o.published).slice(0, 10),
    image: web(o.image), markdown, words: typeof o.words === "number" && o.words > 0 ? Math.round(o.words) : 0,
  };
}

/** Minutes to read `words`, at least one. */
export const readingMinutes = (words: number) => Math.max(1, Math.round(words / 230));
