// A PocketBase for the tests: the few routes the sidecar calls, over Maps, with rev.pb.js's rev contract (tasks: a
// client's own ids, rev 1 on create, a stale rev a 409), a note made
// without a kind a `note` (notes.pb.js), and `links`: one per (from, to, role), made and deleted, either end's delete
// taking it (the relations' cascade). A links filter is `column = "id"` terms joined by ` || `.
// `attachments`: records listed by `note = "id"`, their bytes at /api/files/attachments/<rec>/<file>.
// `/api/tefnotes/link-preview`: a canned preview, 400 for a private address.
// `before`: a hook run ahead of each PATCH and note DELETE, so a test can slip in a write made meanwhile.

import { noteColumns } from "@/core/pocketbase";
import { LINK_COLUMNS } from "@/core/record-links";

type Rec = Record<string, any> & { id: string };

export function fakePb() {
  const notes = new Map<string, Rec>(), chats = new Map<string, Rec>(), tasks = new Map<string, Rec>();
  const links = new Map<string, Rec>();
  const linkKey = (r: Rec) => [...LINK_COLUMNS, "role"].map((c) => r[c] ?? "").join("|");
  /** Links whose column names any of `ids`: what an end's delete takes. */
  const unlink = (ids: Set<string>) => { for (const l of [...links.values()]) if (LINK_COLUMNS.some((c) => ids.has(l[c]))) links.delete(l.id); };
  const tags: Rec[] = [];
  const attachments = new Map<string, Rec & { bytes: Uint8Array }>();
  const created: { col: string; body: Rec }[] = [];
  let n = 0, before: ((r: Rec) => void) | undefined;
  const stamp = () => new Date(Date.now() + n).toISOString().replace("T", " ");
  const err = (status: number, body: object = {}) => Response.json(body, { status });

  const srv = Bun.serve({
    port: 0, hostname: "127.0.0.1",
    async fetch(req) {
      const u = new URL(req.url), f = /^\/api\/files\/attachments\/([\w-]+)\/([^/]+)$/.exec(u.pathname);
      if (f) { const a = attachments.get(f[1]); return a && a.file === decodeURIComponent(f[2]) ? new Response(new Blob([a.bytes as Uint8Array<ArrayBuffer>])) : err(404); }
      if (u.pathname === "/api/tefnotes/link-preview") {      // the server's route: a private address is refused, a page named "empty" says nothing
        const page = u.searchParams.get("url") ?? "";
        if (/\/\/(localhost|10\.)/.test(page)) return err(400, { message: "blocked" });
        return Response.json({ url: page, title: page.includes("empty") ? "" : "Example page", description: "About it", site: "example.com", image: "", icon: "", picture: "" });
      }
      if (u.pathname === "/api/tefnotes/page") {                // the reader's fetch: a private address is refused, "bare" has no article
        const page = u.searchParams.get("url") ?? "";
        if (/\/\/(localhost|10\.)/.test(page)) return err(400, { message: "blocked" });
        const body = page.includes("bare") ? "" : "<article><h1>Rent rules</h1><p>The deposit is two months of rent, returned within thirty days of moving out, minus any damage.</p><p>Notice is three months.</p></article>";
        return Response.json({ url: page, html: `<html><head><title>Rent rules</title></head><body>${body}</body></html>` });
      }
      const m = /^\/api\/collections\/(\w+)\/records(?:\/([\w-]+))?$/.exec(u.pathname);
      if (!m) return err(404);
      const [, col, id] = m;
      if (col === "tags") return Response.json({ items: tags });
      if (col === "attachments") {
        const note = /^note = "(.*)"$/.exec(u.searchParams.get("filter") ?? "")?.[1];
        return Response.json({ items: [...attachments.values()].filter((a) => !note || a.note === note).map(({ bytes: _, ...a }) => a) });
      }
      if (col === "links") {
        if (req.method === "GET") {
          const terms = (u.searchParams.get("filter") ?? "").split(" || ").filter(Boolean).map((t) => /^(\w+) = "(.*)"$/.exec(t)!);
          return Response.json({ items: [...links.values()].filter((l) => !terms.length || terms.some(([, c, v]) => l[c] === v)) });
        }
        if (req.method === "DELETE") return links.delete(id ?? "") ? new Response(null, { status: 204 }) : err(404);
        const body = await req.json() as Rec;
        if (links.has(body.id)) return err(400, { data: { id: { code: "validation_not_unique" } } });
        if ([...links.values()].some((l) => linkKey(l) === linkKey(body))) return err(400, { data: { fromNote: { code: "validation_not_unique" } } });
        const ends = new Set([...notes.values()].map((r) => r.id).concat([...tasks.keys()]));
        if (LINK_COLUMNS.some((c) => body[c] && !ends.has(body[c]))) return err(400, { data: { toNote: { code: "validation_missing_rel_records" } } });
        links.set(body.id, { ...body, created: stamp() });
        return Response.json(links.get(body.id));
      }
      const map = col === "notes" ? notes : col === "chats" ? chats : col === "tasks" ? tasks : null;
      if (!map) return err(404);
      const own = col === "tasks";           // keyed by the client's id
      if (req.method === "GET" && !id) {
        const filter = u.searchParams.get("filter") ?? "", f = /^path = "(.*)"$/.exec(filter), tainted = filter === "tainted = true";
        const items = [...map.values()].filter((r) => (!f || r.path === f[1]) && (!tainted || r.tainted));
        const per = Number(u.searchParams.get("perPage") ?? 30), page = Number(u.searchParams.get("page") ?? 1);
        return Response.json({ items: items.slice((page - 1) * per, page * per) });
      }
      const rec = id ? (col === "notes" ? [...notes.values()].find((r) => r.id === id) : map.get(id)) : undefined;
      if (req.method === "GET") return rec ? Response.json(rec) : err(404);
      if (req.method === "DELETE" && col === "notes") {
        if (!rec) return err(404);
        before?.(rec);
        if (Number(u.searchParams.get("rev")) !== rec.rev) return err(409);
        notes.delete(rec.path);
        return new Response(null, { status: 204 });
      }
      if (req.method === "DELETE" && own) {
        if (!rec) return err(404);
        if (Number(u.searchParams.get("rev")) !== rec.rev) return err(409);
        map.delete(rec.id);
        unlink(new Set([rec.id]));
        return new Response(null, { status: 204 });
      }
      const body = await req.json() as Rec;
      if (req.method === "POST" && own) {
        if (map.has(body.id)) return err(400, { data: { id: { code: "validation_not_unique" } } });
        const r: Rec = { ...body, rev: 1, created: stamp(), updated: stamp() };
        created.push({ col, body });
        map.set(r.id, r);
        return Response.json(r);
      }
      if (req.method === "POST") {
        if ([...map.values()].some((r) => r.path === body.path)) return err(400, { data: { path: { code: "validation_not_unique" } } });
        const r: Rec = { ...body, id: `r${++n}`, rev: 1, updated: stamp(), ...(col === "notes" && !body.kind ? { kind: "note" } : {}) };
        map.set(col === "notes" ? r.path : r.id, r);
        return Response.json(r);
      }
      if (req.method === "PATCH") {
        if (!rec) return err(404);
        if (col === "chats") { Object.assign(rec, body); return Response.json(rec); }
        before?.(rec);
        if (body.rev !== rec.rev) return err(409);
        Object.assign(rec, body, { rev: rec.rev + 1, updated: stamp() });
        return Response.json(rec);
      }
      return err(405);
    },
  });

  /** A note as a client would have written it. */
  const put = (path: string, text: string, extra: Rec | object = {}) => {
    const r = { id: `r${++n}`, ...noteColumns(path, text), kind: "note", rev: 1, updated: stamp(), tainted: false, ...extra };
    notes.set(path, r);
    return r;
  };

  /** A file attached to the note record `note`, as a client would have uploaded it. */
  const attach = (note: string, name: string, bytes: Uint8Array) => {
    const id = `a${++n}`;
    attachments.set(id, { id, note, name, file: `${name.replace(/\.(\w+)$/, "")}_${id}.$1`, bytes });
    return id;
  };

  return {
    url: `http://127.0.0.1:${srv.port}`, notes, chats, tags, tasks, links, created, put, attach, attachments,
    meanwhile: (f?: (r: Rec) => void) => { before = f; },
    stop: () => srv.stop(true),
  };
}
