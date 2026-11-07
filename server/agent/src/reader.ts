// GET /agent/reader?url=<http(s) URL>: a linked page as an article for the clients' reader view (contract:
// packages/core/src/reader.ts). PocketBase fetches the page (pb_hooks/reader.pb.js, through the link-preview guard);
// here Defuddle finds the article in it and writes it as markdown. Defuddle runs with `useAsync: false`: its site
// extractors (YouTube, Reddit, X) would otherwise fetch third-party APIs themselves, past the guard.
//
// 200 an Article; 400 a URL the server won't fetch; 422 a page with no article in it; 502 the site didn't answer.
import { Defuddle } from "defuddle/node";
import { parseHTML } from "linkedom";
import { HttpError } from "@/core/http";
import * as pb from "@/core/pocketbase";
import type { Article } from "@/core/reader";

const fail = (status: number, message: string) => Response.json({ message }, { status });

/** The article in `html`, from the page at `url`; null when there is none. */
export async function parse(html: string, url: string): Promise<Article | null> {
  const { document } = parseHTML(html);
  const d = await Defuddle(document as unknown as Document, url, { markdown: true, useAsync: false });
  const markdown = (d.content ?? "").trim();
  if (!markdown) return null;
  return {
    url, title: d.title ?? "", author: d.author ?? "", site: d.site || d.domain || "", published: (d.published ?? "").slice(0, 10),
    image: /^https:\/\//i.test(d.image ?? "") ? d.image : "", markdown, words: d.wordCount ?? 0,
  };
}

export async function reader(req: Request, server: pb.Server): Promise<Response> {
  const url = new URL(req.url).searchParams.get("url") ?? "";
  if (!/^https?:\/\//i.test(url)) return fail(400, "Only http(s) URLs.");
  let page: { url: string; html: string };
  try { page = await pb.pageHtml(server, url); } catch (e) {
    const s = e instanceof HttpError ? e.status : 0;
    return s === 400 || s === 422 ? fail(s, s === 400 ? "This address can't be read from the server." : "That isn't a web page.")
      : fail(502, "The site didn't answer.");
  }
  const article = await parse(page.html, page.url).catch(() => null);
  if (!article) return fail(422, "No article found on that page.");
  return Response.json(article, { headers: { "Cache-Control": "private, max-age=3600" } });
}
