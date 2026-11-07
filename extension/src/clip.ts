// Sending a page, or a picture on it, to the server in two steps: suggest (POST {server}/api/tefnotes/clip/suggest:
// where JEV would file it, writes nothing), then save (POST {server}/api/tefnotes/clip: where the owner chose). The popup
// is the only place a choice is made; the tags are asked for beside the suggestions (tagsFor); the context menu hands its page to it (background.ts).
// The shapes are packages/core/src/clip.ts's, shared with the phone's Share screen. The picture's bytes: picture.ts.
import { type ClipPage, type ClipResult, type ClipTags, saveBody, sendsFile, suggestBody, type Suggestions, type Target } from "@/core/clip";
import { getServer, hasAccess } from "./settings";

export type Page = ClipPage;

const TEXT_CAP = 50000;
const TIMEOUT_MS = 120_000; // the server's model calls decide how long a suggest or a save takes

/** No server set, or Chrome has not granted it: the user's next step is the options page, not a retry. */
export class SetupError extends Error {}

/** Runs inside the page, so it names nothing outside itself; the cap and the picture's address arrive as arguments.
 *  The picture is found by its address among the page's images: its alt text (or title) and its figure's caption. */
function grab(cap: number, src: string | null) {
  const out = { selection: getSelection()?.toString() ?? "", text: (document.body?.innerText ?? "").slice(0, cap), alt: "", caption: "" };
  const img = src ? [...document.images].find((i) => i.currentSrc === src || i.src === src) : undefined;
  if (img) {
    out.alt = img.alt || img.title || "";
    out.caption = img.closest("figure")?.querySelector("figcaption")?.innerText ?? "";
  }
  return out;
}

const blank = (s: string | undefined) => (s?.trim() ? s : undefined);

/** A request to the server; `init` without a signal. Errors come back as messages fit to show. */
async function call(route: string, init: RequestInit = {}): Promise<Response> {
  const server = await getServer();
  if (!server) throw new SetupError("Set the TEF Notes server's address first.");
  if (!(await hasAccess(server))) throw new SetupError("Allow this extension to reach the server in its settings.");
  let res: Response;
  try {
    res = await fetch(`${server}${route}`, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new Error("Can't reach the server. Check the address and that you are on the server's network.");
  }
  if (!res.ok) {
    const json: unknown = await res.json().catch(() => null);
    const error = json && typeof json === "object" && "error" in json ? String(json.error) : "";
    throw new Error(error || `The server answered ${res.status}.`);
  }
  return res;
}

const json = async <T>(res: Promise<Response>) => (await (await res).json()) as T;

/** The tab's page: its selection and its text, read by a script (activeTab grants it for the click), and the picture
 *  at `src` when the menu was opened on one. `selection` is what the context menu already knows, which also covers a
 *  selection inside a frame the script cannot see. */
export async function readTab(tab: chrome.tabs.Tab, selection?: string, src?: string): Promise<Page> {
  if (!tab.id || !tab.url || !/^https?:/.test(tab.url)) throw new Error("This page can't be saved.");
  // A page the browser won't script (the PDF viewer, the web store) still has a url and a title to file.
  const grabbed = await chrome.scripting
    .executeScript({ target: { tabId: tab.id }, func: grab, args: [TEXT_CAP, src ?? null] })
    .then(([r]) => r?.result)
    .catch(() => undefined);
  return {
    url: tab.url,
    title: tab.title || tab.url,
    selection: blank(selection) ?? blank(grabbed?.selection),
    text: blank(grabbed?.text),
    ...(src && { image: { src, alt: blank(grabbed?.alt), caption: blank(grabbed?.caption) } }),
  };
}

/** A link from the context menu: only its address is known. */
export const linkPage = (url: string): Page => ({ url, title: url });

/** `note`: the owner's words, context for where it goes. `look`: the picture as JEV sees it (base64 JPEG). */
export const suggest = (page: Page, note: string, look?: string) =>
  json<Suggestions>(call("/api/tefnotes/clip/suggest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(suggestBody(page, note, look)),
  }));

/** JEV's tags for the page (every defined tag, scored, and the ones it preselects); asked beside `suggest`, so they show as
 *  soon as they are known. */
export const tagsFor = (page: Page, note: string) =>
  json<ClipTags>(call("/api/tefnotes/clip/tags", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(suggestBody(page, note)),
  }));

/** `target`: a suggested note or task, a new note or a new task. The page text is not sent again, unless `summary` (the
 *  box is ticked): the server writes the picture (`file`, the JPEG to store; an existing task keeps none), the link, the
 *  summary, the owner's note, `line` and the selection. `tags`: the owner's. */
export function save(page: Page, line: string | undefined, target: Target, note: string, summary: boolean, tags: string[], file?: Blob) {
  const form = new FormData();
  form.append("@jsonPayload", JSON.stringify(saveBody(page, line, target, note, summary, tags)));
  if (file && sendsFile(page, target)) form.append("file", file, "picture.jpg");
  return json<ClipResult>(call("/api/tefnotes/clip", { method: "POST", body: form }));
}

/** A picture the extension couldn't fetch itself, through the server (a public one only): its bytes. */
export const pictureViaServer = async (src: string) => (await call(`/api/tefnotes/clip/image?url=${encodeURIComponent(src)}`)).blob();
