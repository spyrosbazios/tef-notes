// The context menu's page, handed to the choice window (popup.html?handoff=<id>) through chrome.storage.session: the
// menu can't show choices itself, and a page with its text is too big for a URL. Taken once, then gone; the session
// area is memory only and cleared when the browser quits.
import type { Page } from "./clip";

/** What the menu handler got: the page, or why there is none. */
export type Handoff = { page: Page } | { error: string };

const key = (id: string) => `handoff:${id}`;

export async function stash(h: Handoff): Promise<string> {
  const id = crypto.randomUUID();
  await chrome.storage.session.set({ [key(id)]: h });
  return id;
}

export async function take(id: string): Promise<Handoff | undefined> {
  const k = key(id), got = await chrome.storage.session.get(k);
  await chrome.storage.session.remove(k);
  return got[k] as Handoff | undefined;
}
