// The installed web app as Android's share target: the manifest's `share_target` (packages/core/vite.ts) has the Share sheet POST
// a link, text or files as multipart to /share, the service worker (web/sw/sw.ts) reads that form once and stashes it
// (share-stash.ts) before redirecting to the page. What the build and both sides agree on. Constants only: the build reads
// this under Node, the stash under a browser.

/** The share target's path under the app's base, and the cache that holds a share between the worker and the page. */
export const SHARE_PATH = "share";
export const SHARE_CACHE = "tefnotes-share";
