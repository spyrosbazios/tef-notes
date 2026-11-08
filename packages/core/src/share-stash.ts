// A share held between the service worker that receives it and the page that files it: the form the share target POSTs
// (packages/core/src/share-target.ts, the manifest's `share_target`) in the Cache API, so it survives the redirect and the
// page's load; taking it empties it. Pure over a `Stash`, so tests run it on a map (packages/core/test/share-target.test.ts).
// The worker is web/sw/sw.ts, the page web/src/components/share-page.tsx.

/** The part of a Cache the stash uses. */
export type Stash = Pick<Cache, "put" | "match" | "keys" | "delete">;

/** A share as the form held it: the three text fields Android fills (the link usually in `text`, sometimes in `title`, rarely
 *  in `url`) and the files, in the order they came. */
export type Posted = { title: string; text: string; url: string; files: File[] };

const META = "/share-stash/meta";
const file = (i: number) => `/share-stash/file/${i}`;

type Meta = { title: string; text: string; url: string; files: { name: string; type: string }[] };

const field = (form: FormData, k: string) => { const v = form.get(k); return typeof v === "string" ? v : ""; };

async function empty(cache: Stash) {
  for (const k of await cache.keys()) await cache.delete(k);
}

/** The share target's form into the stash, replacing whatever an earlier share left. The form is read by the caller, once:
 *  a request's body can be read no more. */
export async function stashPost(cache: Stash, form: FormData): Promise<void> {
  await empty(cache);
  const files = form.getAll("files").filter((v): v is File => typeof v !== "string");
  const meta: Meta = { title: field(form, "title"), text: field(form, "text"), url: field(form, "url"), files: files.map((f) => ({ name: f.name, type: f.type })) };
  await Promise.all(files.map((f, i) => cache.put(file(i), new Response(f))));
  await cache.put(META, Response.json(meta));
}

/** The stashed share, and the stash emptied; null when there is none (the page was opened directly, or the share was taken). */
export async function takePost(cache: Stash): Promise<Posted | null> {
  const r = await cache.match(META);
  if (!r) return null;
  try {
    const m: Partial<Meta> = await r.json();
    const files: File[] = [];
    for (const [i, f] of (Array.isArray(m.files) ? m.files : []).entries()) {
      const bytes = await cache.match(file(i));
      if (bytes && typeof f?.name === "string") files.push(new File([await bytes.blob()], f.name, { type: typeof f.type === "string" ? f.type : "" }));
    }
    return { title: typeof m.title === "string" ? m.title : "", text: typeof m.text === "string" ? m.text : "", url: typeof m.url === "string" ? m.url : "", files };
  } catch {
    return null;
  } finally {
    await empty(cache);
  }
}
