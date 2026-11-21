// The settings, in chrome.storage.sync: the notes server's address, and the popup's "Add a summary" box as it was left.
// The extension holds no key and no sign-in: the server must only be reachable on a private network. Chrome grants network access to that
// origin alone, asked for at runtime.

/** `input` as a server origin (`https://host:port`); throws a message fit for the options page. */
export function toOrigin(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("Enter a full address, like https://host:port");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("The address must start with https:// or http://");
  return url.origin;
}

const pattern = (origin: string) => ({ origins: [`${origin}/*`] });

export async function getServer(): Promise<string | undefined> {
  const { server } = await chrome.storage.sync.get("server");
  return typeof server === "string" && server ? server : undefined;
}

/** Ask Chrome for access to `origin` (needs a user gesture), then keep it, and give up the access the previous address had:
 *  the extension reaches the one server it is set to. False if the user declined (the old address and its access stay). */
export async function setServer(origin: string): Promise<boolean> {
  if (!(await chrome.permissions.request(pattern(origin)))) return false;
  const was = await getServer();
  await chrome.storage.sync.set({ server: origin });
  if (was && was !== origin) await chrome.permissions.remove(pattern(was));
  return true;
}

/** The popup's "Add a summary" box: off until ticked, then as it was left. */
export async function getSummary(): Promise<boolean> {
  const { summary } = await chrome.storage.sync.get("summary");
  return summary === true;
}

export const setSummary = (on: boolean) => chrome.storage.sync.set({ summary: on });

export const hasAccess = (origin: string) => chrome.permissions.contains(pattern(origin));
