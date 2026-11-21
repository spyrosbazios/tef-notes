// Requests from other sites (pb_hooks/origin.pb.js) against a real PocketBase: the headers a browser would send, set by
// hand. The server serves no signed extension here, so any extension origin is taken.
import { expect, test } from "bun:test";
import * as pb from "../../packages/core/src/pocketbase";

const url = process.env.TEF_CONTRACT_URL;
if (!url || !/^http:\/\/127\.0\.0\.1:\d+$/.test(url)) throw new Error("Run bun --no-env-file server/integration/run.ts");
const s = { url };
let serial = 0;
const id = () => `origin${String(++serial).padStart(9, "0")}`;
const EVIL = { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "no-cors" };
const EXTENSION = { Origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop", "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "cors" };

/** A note create as a page could send it without a preflight: a form POST. */
function formCreate(path: string, headers: Record<string, string>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(pb.noteColumns(path, "# From a form\n"))) form.append(k, Array.isArray(v) ? JSON.stringify(v) : String(v));
  return fetch(`${url}/api/collections/notes/records`, { method: "POST", body: form, headers });
}

test("a page on another site can't create, change or delete a note, nor clip", async () => {
  const path = `notes/${id()}.md`;
  const refused = await formCreate(path, EVIL);
  expect(refused.status).toBe(403);
  expect(await pb.read(s, path)).toBeNull();

  const n = await pb.create(s, pb.recordId(), `notes/${id()}.md`, "# Mine\n");
  const record = `${url}/api/collections/notes/records/${n.rec}`;
  const patch = await fetch(record, { method: "PATCH", body: JSON.stringify({ rev: n.rev, text: "gone" }), headers: { ...EVIL, "Content-Type": "text/plain" } });
  expect(patch.status).toBe(403);
  expect((await fetch(`${record}?rev=${n.rev}`, { method: "DELETE", headers: EVIL })).status).toBe(403);
  expect(await pb.get(s, n.rec)).toEqual(n);

  const clip = new FormData();
  clip.append("@jsonPayload", JSON.stringify({ title: "Evil", selection: "Planted", target: { kind: "new" } }));
  expect((await fetch(`${url}/api/tefnotes/clip`, { method: "POST", body: clip, headers: EVIL })).status).toBe(403);
});

test("a page on another site can't make the server fetch for it", async () => {
  for (const route of ["tefnotes/page", "tefnotes/clip/image", "tefnotes/link-preview"]) {
    const res = await fetch(`${url}/api/${route}?url=${encodeURIComponent("https://example.com/")}`, { headers: EVIL });
    expect(res.status).toBe(403);
  }
});

test("CORS answers no other site, and the extension", async () => {
  const evil = await fetch(`${url}/api/collections/notes/records`, { headers: { Origin: "https://evil.example" } });
  expect(evil.headers.get("Access-Control-Allow-Origin")).toBeNull();
  const ext = await fetch(`${url}/api/collections/notes/records`, { headers: { Origin: EXTENSION.Origin } });
  expect(ext.headers.get("Access-Control-Allow-Origin")).toBe(EXTENSION.Origin);
});

test("the web app, an older browser on this host, the extension and non-browsers still write", async () => {
  for (const headers of <Record<string, string>[]>[
    { Origin: url!, "Sec-Fetch-Site": "same-origin", "Sec-Fetch-Mode": "cors" },
    { Origin: url! },
    { Origin: "https://notes.example.net", "X-Forwarded-Host": "notes.example.net" },
    EXTENSION,
    {},
  ]) {
    const path = `notes/${id()}.md`;
    const res = await formCreate(path, headers);
    expect(res.status, JSON.stringify(headers)).toBe(200);
    expect((await pb.read(s, path))?.path).toBe(path);
  }
  const clip = new FormData();
  clip.append("@jsonPayload", JSON.stringify({ id: "extclip00000001", title: "From the extension", selection: "Words", target: { kind: "new" } }));
  expect((await fetch(`${url}/api/tefnotes/clip`, { method: "POST", body: clip, headers: EXTENSION })).status).toBe(200);
});
