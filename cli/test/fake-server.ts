// A just-enough PocketBase for the CLI: collections in memory, the rev contract on PATCH, and a log of every write that
// came in, so a test can look at what each command put on the wire.
export type Write = { method: string; collection: string; id?: string; body: any };

/** `refuse(w)`: a status to answer instead of doing the write (nothing is kept); `lose(w)`: the write is done and kept, and the
 *  answer is a 503, as a reply lost on the way is for a client. Both are set by a test and see every write that comes in. */
export type Faults = { refuse?: (w: Write) => number | undefined; lose?: (w: Write) => boolean };

export function fakeServer() {
  const faults: Faults = {};
  const store = new Map<string, Map<string, any>>();
  const writes: Write[] = [];
  let n = 0;
  const coll = (name: string) => store.get(name) ?? store.set(name, new Map()).get(name)!;
  const json = (v: unknown, status = 200) => Response.json(v, { status });

  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url), parts = url.pathname.split("/").filter(Boolean);
      if (url.pathname === "/agent/drawing-picture") return new Response(new Blob(["png"], { type: "image/png" }));
      if (url.pathname === "/api/tefnotes/tags/describe") return json([...coll("tags").values()].map((t) => ({ tag: t.name, description: `about ${t.name}` })));
      if (parts[0] !== "api" || parts[1] !== "collections" || parts[3] !== "records") return json({ error: `no route ${url.pathname}` }, 404);
      const name = parts[2], id = parts[4], records = coll(name);
      if (req.method === "GET") {
        if (id) return records.has(id) ? json(records.get(id)) : json({}, 404);
        const filter = url.searchParams.get("filter") ?? "", key = name === "notes" ? "path" : name === "attachments" ? "note" : "";
        const want = key ? new RegExp(`${key} = "([^"]*)"`).exec(filter)?.[1] : undefined;
        return json({ items: [...records.values()].filter((r) => want === undefined || r[key] === want) });
      }
      if (req.method === "DELETE") { records.delete(id); writes.push({ method: "DELETE", collection: name, id, body: null }); return new Response(null, { status: 204 }); }
      const refused = (w: Write) => { const status = faults.refuse?.(w); return status ? json({}, status) : undefined; };
      const lost = (w: Write, answer: Response) => (faults.lose?.(w) ? json({}, 503) : answer);
      const form = req.headers.get("content-type")?.startsWith("multipart/");
      const body: any = form ? Object.fromEntries([...(await req.formData()).entries()].map(([k, v]) => [k, typeof v === "string" ? v : "(file)"])) : await req.json();
      const w: Write = { method: req.method, collection: name, id, body };
      const no = refused(w);
      if (no) return no;
      writes.push(w);
      if (req.method === "POST") {
        const rec = { ...body, id: body.id ?? `r${++n}`.padEnd(15, "0"), rev: 1, kind: "note", file: body.name };
        if (records.has(rec.id) || (name === "notes" && [...records.values()].some((r) => r.path === rec.path))) return json({}, 409);
        records.set(rec.id, rec);
        return lost(w, json(rec));
      }
      const cur = records.get(id);
      if (!cur) return json({}, 404);
      if (body.rev !== undefined && body.rev !== cur.rev) return json({}, 409);
      const next = { ...cur, ...body, rev: cur.rev + 1 };
      records.set(id, next);
      return lost(w, json(next));
    },
  });
  return { url: `http://127.0.0.1:${server.port}`, writes, faults, records: coll, stop: () => server.stop(true) };
}
