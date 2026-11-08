// A note's link cards and their summaries, as markdown lines: a line that is only one link is what the editor draws as a
// card (web/src/editor/link-cards.ts `cardUrl`), and a blockquote whose first line is "Summary" right under it is what
// its Summary button puts there (link-tools.ts `summarised`). For the agent's summarise_links, which writes the very
// block the button does (server/pb_hooks/summary.pb.js), so the editor joins it to the card.

const LINK = /^\[[^\]\n]*\]\((https?:\/\/[^\s<>()]+)\)$/;
const BARE = /^<?(https?:\/\/[^\s<>]+?)>?$/;
const SUMMARY = /^>\s*(\*\*)?summary\b/i;
const FENCE = /^\s*(```|~~~)/;

/** The URL a line is by itself (one `[label](url)`, or a bare URL, unindented), or null. */
export function lineUrl(line: string): string | null {
  if (/^\s/.test(line)) return null;
  const t = line.trimEnd();
  return LINK.exec(t)?.[1] ?? BARE.exec(t)?.[1] ?? null;
}

/** Each link card in `body` (outside code fences) with the index of its line, and whether a summary is already under it. */
export function cardLines(body: string): { url: string; at: number; summarised: boolean }[] {
  const lines = body.split("\n"), out: { url: string; at: number; summarised: boolean }[] = [];
  let fenced = false;
  lines.forEach((line, at) => {
    if (FENCE.test(line)) { fenced = !fenced; return; }
    const url = fenced ? null : lineUrl(line);
    if (!url) return;
    let next = at + 1;
    while (next < lines.length && !lines[next].trim()) next++;
    out.push({ url, at, summarised: next < lines.length && SUMMARY.test(lines[next]) });
  });
  return out;
}

/** `body` with each block in `blocks` (by URL) put right under every card of that URL that has no summary yet, a blank
 *  line either side (a quote with a line straight after it would swallow that line). */
export function withSummaries(body: string, blocks: Map<string, string>): string {
  const lines = body.split("\n");
  for (const c of cardLines(body).reverse()) {
    const block = !c.summarised && blocks.get(c.url)?.trim();
    if (!block) continue;
    const after = lines[c.at + 1];
    lines.splice(c.at + 1, 0, "", ...block.split("\n"), ...(after?.trim() ? [""] : []));
  }
  return lines.join("\n");
}
