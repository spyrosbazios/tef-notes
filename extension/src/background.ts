// The service worker: the "Save to TEF Notes" context-menu item (page, selection, link, image). A menu can't show the
// choice of where to save, so it reads the page (activeTab is granted for the click) and, on an image, the page's words
// for it, hands it over (handoff.ts) and opens the popup's own page in a small window to choose in; that window
// fetches the picture itself (picture.ts). A window, not chrome.action.openPopup(): that one needs a focused
// window with the toolbar showing and rejects otherwise.
//
// Nothing a click starts may fail unseen: a listener's rejection only reaches chrome://extensions -> Errors. A window
// Chrome refuses opens as a tab instead; when nothing could be opened, the toolbar icon shows "!" on that tab and its
// tooltip says why.
import { C } from "@/core/theme";
import { linkPage, type Page, readTab } from "./clip";
import { type Handoff, stash } from "./handoff";
import { getServer } from "./settings";

const MENU = "save-to-tefnotes";
const TITLE = "Save to TEF Notes";
const WIDTH = 380, HEIGHT = 560;

// An update keeps the old version's item, and create() with its id fails: an item from before images stayed page-only.
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => chrome.contextMenus.create({ id: MENU, title: TITLE, contexts: ["page", "selection", "link", "image"] }));
  void getServer().then((server) => { if (!server) void chrome.runtime.openOptionsPage(); });
});

/** An image is saved with the page it is on, even inside a link; else a selection wins over the link it may sit in,
 *  and a link alone is saved by its address, not as the page it is on. */
function read(info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab): Promise<Page> {
  const image = info.mediaType === "image" ? info.srcUrl : undefined;
  const link = image || info.selectionText ? undefined : info.linkUrl;
  if (link) return Promise.resolve(linkPage(link));
  if (!tab) return Promise.reject(new Error("No page to save."));
  return readTab(tab, info.selectionText, image);
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The choice page for handoff `id`. No left/top: the clicked window's reported bounds are not where it is on Wayland
 *  (a client there can neither read nor set its position), and Chrome refuses a window less than half on a screen,
 *  so a computed position lost the whole window. Chrome places it itself. Refused anyway: a tab beside the page. */
async function open(id: string, tab?: chrome.tabs.Tab) {
  const url = `popup.html?handoff=${id}`;
  try {
    await chrome.windows.create({ url, type: "popup", width: WIDTH, height: HEIGHT, focused: true });
  } catch (e) {
    console.error("TEF Notes: the choice window was refused, opening a tab:", message(e));
    await chrome.tabs.create({ url, ...(tab?.id != null && { openerTabId: tab.id, index: tab.index + 1, windowId: tab.windowId }) });
  }
}

/** The toolbar icon on the clicked tab: "!" and why, or (`error` undefined) back to normal. */
async function flag(tab: chrome.tabs.Tab | undefined, error?: string) {
  const tabId = tab?.id;
  if (tabId == null) return;
  await chrome.action.setBadgeBackgroundColor({ tabId, color: C.down });
  await chrome.action.setBadgeText({ tabId, text: error ? "!" : "" });
  await chrome.action.setTitle({ tabId, title: error ? `${TITLE}: ${error}` : TITLE });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU) return;
  void (async () => {
    let h: Handoff;
    try {
      h = { page: await read(info, tab) };
    } catch (e) {
      h = { error: message(e) };
    }
    await open(await stash(h), tab);
    await flag(tab);
  })().catch((e: unknown) => {
    console.error("TEF Notes: the context menu's save failed:", message(e));
    void flag(tab, `couldn't open the choice window (${message(e)})`).catch(() => undefined);
  });
});
