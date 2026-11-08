// The app's service worker (vite-plugin-pwa, injectManifest; vite.config.ts): the built app precached, so a return visit opens
// what is installed, and a new deploy waits until the page asks for it (src/components/update-toast.tsx posts SKIP_WAITING).
// Nothing the server answers is cached: /api, /agent, the admin UI and the extension's files bypass the navigation fallback.
// And the share target: Android's Share sheet POSTs to /share (the manifest's `share_target`, packages/core/vite.ts). The
// worker reads that form once, stashes it (core/share-stash.ts) and redirects to the page, which takes it from the stash.
// And task reminders: the server's push (core/push.ts) becomes a notification, whose tap opens the task.
import { deviceLabel, payloadOf, serverKeyOf, subscriptionOf } from "@/core/push";
import { stashPost } from "@/core/share-stash";
import { SHARE_CACHE, SHARE_PATH } from "@/core/share-target";
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute, type PrecacheEntry } from "workbox-precaching";
import { CacheableResponsePlugin } from "workbox-cacheable-response";
import { ExpirationPlugin } from "workbox-expiration";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { CacheFirst } from "workbox-strategies";

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (string | PrecacheEntry)[] };

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL("index.html"), { denylist: [/^\/api\//, /^\/agent\//, /^\/_\//, /^\/extension\//] }));

// The one thing from the server that is kept: the files of two collections, on this origin only: a note's attachments and
// their thumbnails (`/api/files/attachments/<id>/<name>`, `?thumb=` a size of its own) and a link's saved picture
// (`/api/files/link_previews/...`), once seen, so a note's pictures draw offline. Neither changes (a replaced drawing is a new
// record, a picture a new file name), so cache-first is exact. A Range request (a PDF read in parts) is left to the network: a stored whole
// answering it would be the wrong shape. Bounded by count and age; the rest of /api is never cached (offline reads come from
// the query cache, src/lib/persist.ts).
registerRoute(
  ({ url, request }) => url.origin === self.location.origin && /^\/api\/files\/(attachments|link_previews)\//.test(url.pathname) && !request.headers.has("range"),
  new CacheFirst({
    cacheName: "attachment-files",
    plugins: [new CacheableResponsePlugin({ statuses: [200] }), new ExpirationPlugin({ maxEntries: 400, maxAgeSeconds: 30 * 24 * 60 * 60, purgeOnQuotaError: true })],
  }),
);

self.addEventListener("message", (e) => { if (e.data?.type === "SKIP_WAITING") void self.skipWaiting(); });
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// The app's own path to the share target, wherever it is served from (the scope is the build's base)
const scope = new URL(self.registration.scope);
const shareUrl = new URL(SHARE_PATH, scope);

/** Stash the share and send the browser on to the page. A share that can't be read leaves nothing, and the page is told
 *  (`?shared=err`) rather than shown an empty box as if nothing had been shared. */
async function shared(request: Request): Promise<Response> {
  try {
    await stashPost(await caches.open(SHARE_CACHE), await request.formData());
  } catch {
    return Response.redirect(`${shareUrl.href}?shared=err`, 303);
  }
  return Response.redirect(`${shareUrl.href}?shared=1`, 303);
}

self.addEventListener("fetch", (e) => {
  if (e.request.method === "POST" && new URL(e.request.url).pathname === shareUrl.pathname) e.respondWith(shared(e.request));
});

// A reminder (the contract: core/push.ts). `tag` makes a second one for the same task replace the first. The payload carries a path on the app's origin, which a tap opens.
/** `url` made absolute against the app, when it stays on the app's own origin; the app's start otherwise. */
const sameOrigin = (url: unknown): string => {
  try {
    const u = new URL(typeof url === "string" ? url : "", scope.origin);
    return u.origin === self.location.origin ? u.href : scope.href;
  } catch { return scope.href; }
};

self.addEventListener("push", (e) => {
  let p;
  try { p = payloadOf(e.data?.json()); } catch { p = null; }
  if (!p) return;
  e.waitUntil(self.registration.showNotification(p.title, {
    body: p.body, tag: p.tag, icon: new URL("icon.png", scope).href, data: { url: sameOrigin(p.url) },
  }));
});

/** The app opened at `url`. An open window is focused and told to go there (`{ type: "navigate", url }`, taken by
 *  src/components/update-toast.tsx): `WindowClient.navigate` would reload the page and lose a note being typed (hooks/draft.ts
 *  saves 800 ms after a keystroke). A new window only when there is none. */
async function show(url: string): Promise<void> {
  const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const mine = open.find((c) => new URL(c.url).origin === scope.origin);
  if (!mine) { await self.clients.openWindow(url); return; }
  const u = new URL(url);
  await mine.focus();
  mine.postMessage({ type: "navigate", url: u.pathname + u.search + u.hash });
}

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(show(sameOrigin(e.notification.data?.url)));
});

// The browser rotated or expired this device's subscription: take a new one with the same key and hand it to the server, which
// replaces nothing it knew by endpoint (the old record ends on its own: the push service answers it 404 or 410).
self.addEventListener("pushsubscriptionchange", (e) => e.waitUntil(resubscribe(e as PushSubscriptionChangeEvent)));

async function resubscribe(e: PushSubscriptionChangeEvent): Promise<void> {
  const reg = self.registration;
  let sub = e.newSubscription ?? (await reg.pushManager.getSubscription());
  if (!sub) {
    let key: BufferSource | null = e.oldSubscription?.options.applicationServerKey ?? null;
    if (!key) {
      const r = await fetch(new URL("/agent/push/key", scope.origin));
      const bytes = r.ok ? serverKeyOf(((await r.json()) as { publicKey?: string }).publicKey ?? "") : null;
      if (!bytes) return;
      key = bytes;
    }
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  }
  const body = subscriptionOf({ ...sub.toJSON(), label: deviceLabel(self.navigator.userAgent) });
  if (!body) return;
  await fetch(new URL("/agent/push/subscribe", scope.origin), {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}
