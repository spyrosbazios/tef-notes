// A PocketBase for the tests: the few routes the sidecar calls, over Maps, with rev.pb.js's rev contract (tasks: a
// client's own ids, rev 1 on create, a stale rev a 409), a note made
// without a kind a `note` (notes.pb.js), and `links`: one per (from, to, role), made and deleted, either end's delete
// taking it (the relations' cascade). A links filter is `column = "id"` terms joined by ` || `. A listing pages the way the
// record protocol asks (keyset): `(<filter>)`, and ` && id > "<last>"` after its first page, sorted by id.
// `attachments`: records listed by `note = "id"`, their bytes at /api/files/attachments/<rec>/<file>.
// `/api/tefnotes/link-preview`: a canned preview, 400 for a private address.
// `chats`: under the rev contract too (a record without one reads as 0), `messages` capped at 20 MB as the field is;
// `chat_files`: a chat's attached files, their bytes at /api/files/chat_files/<rec>/<file>.
// `before`: a hook run ahead of each PATCH and note DELETE, so a test can slip in a write made meanwhile.

import { noteColumns } from "@/core/record-contracts";
import { LINK_COLUMNS } from "@/core/record-links";

type Rec = Record<string, any> & { id: string };

export function fakePb() {
  const notes = new Map<string, Rec>(), chats = new Map<string, Rec>(), tasks = new Map<string, Rec>();
  const links = new Map<string, Rec>();
  const linkKey = (r: Rec) => [...LINK_COLUMNS, "role"].map((c) => r[c] ?? "").join("|");
  /** Links whose column names any of `ids`: what an end's delete takes. */
  const unlink = (ids: Set<string>) => { for (const l of links.values()) if (LINK_COLUMNS.some((c) => ids.has(l[c]))) links.delete(l.id); };
  const tags: Rec[] = [], lenses: Rec[] = [], prefs: Rec[] = [];
  const attachments = new Map<string, Rec & { bytes: Uint8Array }>(), chatFiles = new Map<string, Rec & { bytes: Uint8Array }>();
  /** `chats.messages`' cap (pb_migrations/1792600000_chats.js), and how many chat saves landed. */
  const CHAT_MAX = 20_000_000;
  let chatSaves = 0;
  const withoutBytes = (r: Rec & { bytes: Uint8Array }) => { const { bytes: _, ...a } = r; return a; };
  const created: { col: string; body: Rec }[] = [];
  let n = 0, before: ((r: Rec) => void) | undefined;
  const stamp = () => new Date(Date.now() + n).toISOString().replace("T", " ");
  const err = (status: number, body: object = {}) => Response.json(body, { status });
  /** A listing's filter without the keyset paging's wrapping, and the id it pages after. */
  const keyset = (raw: string) => {
    const m = /^(?:\((.*)\))?(?: && )?(?:id > "(.*)")?$/.exec(raw);
    return m ? { filter: m[1] ?? "", after: m[2] } : { filter: raw, after: undefined };
  };
  const page = (rows: Rec[], after: string | undefined) => rows.filter((r) => after == null || r.id > after).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const srv = Bun.serve({
    port: 0, hostname: "127.0.0.1",
    async fetch(req) {
      const u = new URL(req.url), f = /^\/api\/files\/attachments\/([\w-]+)\/([^/]+)$/.exec(u.pathname);
      if (f) { const a = attachments.get(f[1]); return a && a.file === decodeURIComponent(f[2]) ? new Response(new Blob([a.bytes as Uint8Array<ArrayBuffer>])) : err(404); }
      const cf = /^\/api\/files\/chat_files\/([\w-]+)\/([^/]+)$/.exec(u.pathname);
      if (cf) { const a = chatFiles.get(cf[1]); return a && a.file === decodeURIComponent(cf[2]) ? new Response(new Blob([a.bytes as Uint8Array<ArrayBuffer>])) : err(404); }
      if (u.pathname.startsWith("/api/collections/chat_files/records")) {   // a chat's attached file: under a chat that exists
        const del = /records\/([\w-]+)$/.exec(u.pathname)?.[1];
        if (req.method === "DELETE") return del && chatFiles.delete(del) ? new Response(null, { status: 204 }) : err(404);
        const form = await req.formData(), chat = String(form.get("chat")), file = form.get("file") as File;
        if (!chats.has(chat)) return err(400, { data: { chat: { code: "validation_missing_rel_records" } } });
        if (file.size > 8 * 1024 * 1024) return err(400, { data: { file: { code: "validation_file_size_limit" } } });
        const rid = `f${++n}`, rec = { id: rid, chat, name: String(form.get("name") ?? ""), file: `${file.name.replace(/\.(\w+)$/, "")}_${rid}.${/\.(\w+)$/.exec(file.name)?.[1] ?? "bin"}`, bytes: new Uint8Array(await file.arrayBuffer()) };
        chatFiles.set(rid, rec);
        return Response.json(withoutBytes(rec));
      }
      if (u.pathname === "/api/tefnotes/link-preview") {      // the server's route: a private address is refused, a page named "empty" says nothing
        const page = u.searchParams.get("url") ?? "";
        if (/\/\/(localhost|10\.)/.test(page)) return err(400, { message: "blocked" });
        return Response.json({ url: page, title: page.includes("empty") ? "" : "Example page", description: "About it", site: "example.com", image: "", icon: "", picture: "" });
      }
      if (u.pathname === "/api/tefnotes/summary" && req.method === "POST") {   // the Summary button's route: "empty" has nothing to summarise
        const page = String(((await req.json()) as { url?: string }).url ?? "");
        return page.includes("empty") ? err(422, { error: "There is nothing on that page to summarise." }) : Response.json({ summary: `> **Summary**\n> About ${page}.` });
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
      if (col === "lenses") {                                 // create_lens: open rules, no rev
        if (req.method === "GET") return Response.json({ items: lenses });
        const lens = { ...(await req.json() as Rec), id: `lens${lenses.length + 1}` }; lenses.push(lens);
        return Response.json(lens);
      }
      if (col === "prefs") {                                  // the owner's one record, under the rev contract: made at rev 1, saved at the rev read
        if (req.method === "GET") return Response.json({ items: prefs });
        const body = await req.json() as Rec;
        if (req.method === "POST") {
          if (prefs.some((p) => p.key === body.key)) return err(400, { data: { key: { code: "validation_not_unique" } } });
          const rec = { ...body, id: "prefs1", rev: 1 }; prefs.push(rec); return Response.json(rec);
        }
        const rec = prefs.find((p) => p.id === id);
        if (!rec) return err(404);
        before?.(rec);
        if (body.rev !== (rec.rev ?? 0)) return err(409, { message: "This preferences record changed since that version." });
        Object.assign(rec, body, { rev: (rec.rev ?? 0) + 1 });
        return Response.json(rec);
      }
      if (col === "tags") {
        if (req.method === "GET") return Response.json({ items: tags });
        const body = await req.json() as Rec;
        if (tags.some((t) => t.id !== id && t.name.toLowerCase() === body.name.toLowerCase())) return err(400, { message: "Tag name already exists" });
        if (req.method === "POST") {
          const tag = { ...body, id: `tag${tags.length + 1}` }; tags.push(tag);
          return Response.json(tag);
        }
        const tag = tags.find((t) => t.id === id);
        if (!tag) return err(404);
        Object.assign(tag, body);
        return Response.json(tag);
      }
      if (col === "attachments" && req.method === "POST") {   // an upload: the name unique per note, as the server's index makes it
        const form = await req.formData(), note = String(form.get("note")), name = String(form.get("name")), f = form.get("file") as Blob;
        if ([...attachments.values()].some((x) => x.note === note && x.name === name)) return err(400, { data: { name: { code: "validation_not_unique" } } });
        const rec = attach(note, name, new Uint8Array(await f.arrayBuffer()));
        return Response.json(withoutBytes(attachments.get(rec)!));
      }
      if (col === "attachments" && req.method === "DELETE") return attachments.delete(id ?? "") ? new Response(null, { status: 204 }) : err(404);
      if (col === "attachments") {
        const note = /^note = "(.*)"$/.exec(u.searchParams.get("filter") ?? "")?.[1];
        return Response.json({ items: [...attachments.values()].filter((a) => !note || a.note === note).map(withoutBytes) });
      }
      if (col === "links") {
        if (req.method === "GET") {
          const { filter, after } = keyset(u.searchParams.get("filter") ?? "");
          const terms = filter.split(" || ").filter(Boolean).map((t) => /^(\w+) = "(.*)"$/.exec(t)!);
          return Response.json({ items: page([...links.values()].filter((l) => !terms.length || terms.some(([, c, v]) => l[c] === v)), after) });
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
        const { filter, after } = keyset(u.searchParams.get("filter") ?? ""), f = /^path = "(.*)"$/.exec(filter), tainted = filter === "tainted = true";
        const items = [...map.values()].filter((r) => (!f || r.path === f[1]) && (!tainted || r.tainted));
        const per = Number(u.searchParams.get("perPage") ?? 30), at = Number(u.searchParams.get("page") ?? 1);
        return Response.json({ items: u.searchParams.get("sort") === "id" ? page(items, after).slice(0, per) : items.slice((at - 1) * per, at * per) });
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
        if (body.id && [...map.values()].some((r) => r.id === body.id)) return err(400, { data: { id: { code: "validation_not_unique" } } });
        const r: Rec = { ...body, id: body.id ?? `r${++n}`, rev: 1, updated: stamp(), ...(col === "notes" && !body.kind ? { kind: "note" } : {}) };
        map.set(col === "notes" ? r.path : r.id, r);
        return Response.json(r);
      }
      if (req.method === "PATCH") {
        if (!rec) return err(404);
        if (col === "chats") {                                // a chat from before its rev column reads as 0
          if (body.rev !== (rec.rev ?? 0)) return err(409, { message: "This chat changed since that version." });
          if (JSON.stringify(body.messages ?? null).length > CHAT_MAX) return err(400, { data: { messages: { code: "validation_json_size_limit" } } });
          chatSaves++;
          Object.assign(rec, body, { rev: (rec.rev ?? 0) + 1 });
          return Response.json(rec);
        }
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
    url: `http://127.0.0.1:${srv.port}`, notes, chats, tags, lenses, prefs, tasks, links, created, put, attach, attachments, chatFiles,
    chatSaves: () => chatSaves,
    meanwhile: (f?: (r: Rec) => void) => { before = f; },
    stop: () => srv.stop(true),
  };
}
