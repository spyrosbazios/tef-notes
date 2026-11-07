// Web search for the agent through Exa (the `exa` key, keys.ts). Exa's recommended tool shape
// (exa.ai/docs/search/best-practices): the model writes query + objective, search is type auto with highlights
// (excerpts sized to relevance), and full text only for pages it picks. What comes back is a claim, not data:
// every result carries its URL.
import { getJson, HttpError } from "@/core/http";
import { key } from "./keys";

export const PAGE = 10_000;        // chars per page read_url hands back — exa-js's default cap

async function exa(path: string, body: object, signal?: AbortSignal) {
  const k = await key("exa");
  if (!k) return { error: "Web search isn't set up on the notes server (no Exa key)." };
  try {
    return await getJson(`https://api.exa.ai${path}`, {
      method: "POST", headers: { "x-api-key": k, "Content-Type": "application/json" }, body: JSON.stringify(body), signal,
    }, 2, 20_000);
  } catch (e) {
    if (signal?.aborted) return { error: "Stopped." };
    const s = e instanceof HttpError ? e.status : 0;
    return { error: s === 401 ? "Exa rejected the API key." : s === 402 ? "The Exa account is out of credits."
      : s === 429 ? "Exa rate limit. Try again shortly." : `Exa: ${(e as Error).message}` };
  }
}

type Hit = { title?: string; url: string; publishedDate?: string; author?: string; highlights?: string[]; text?: string };
const day = (d?: string) => d?.slice(0, 10) ?? null;

export async function search({ query, objective, days, domains }: { query: string; objective: string; days?: number; domains?: string[] }, signal?: AbortSignal) {
  const r = await exa("/search", {
    query, objective, type: "auto", numResults: 10,
    ...(days ? { startPublishedDate: new Date(Date.now() - days * 86_400_000).toISOString() } : {}),
    ...(domains?.length ? { includeDomains: domains } : {}),
    contents: { highlights: true },
  }, signal);
  if (r.error) return r;
  return { results: ((r.results ?? []) as Hit[]).map((h) => ({ title: h.title ?? null, url: h.url, published: day(h.publishedDate), author: h.author ?? null, excerpts: h.highlights ?? [] })) };
}

type Status = { id: string; status: "success" | "error"; error?: { tag?: string; httpStatusCode?: number } };

export async function read(urls: string[], signal?: AbortSignal) {
  if (urls.some((u) => !/^https?:\/\//.test(u))) return { error: "Only http(s) URLs." };
  const r = await exa("/contents", { urls, text: { maxCharacters: PAGE } }, signal);
  if (r.error) return r;
  const failed = ((r.statuses ?? []) as Status[]).filter((s) => s.status === "error")
    .map((s) => ({ url: s.id, error: [s.error?.tag ?? "error", s.error?.httpStatusCode && `HTTP ${s.error.httpStatusCode}`].filter(Boolean).join(", ") }));
  const pages = ((r.results ?? []) as Hit[]).map((p) => ({
    url: p.url, title: p.title ?? null, published: day(p.publishedDate), text: p.text ?? "", ...((p.text?.length ?? 0) >= PAGE ? { truncated: true } : {}),
  }));
  return failed.length ? { pages, failed } : { pages };
}
