// What `tefnotes` does when a write goes wrong, against a fake server that can refuse a write or lose its answer: nothing is
// made twice (a lost reply is sent again under the same id, an append is never added on top of itself), nothing the owner has
// is thrown away before its replacement is in place, and a text that can't be saved stays on disk and is named.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeServer } from "./fake-server";

const CLI = join(import.meta.dir, "..", "tefnotes.ts");
const SCENE = JSON.stringify({ type: "excalidraw", version: 2, elements: [{ id: "a", type: "rectangle", x: 0, y: 0, width: 10, height: 10 }] });

let root: string, srv: ReturnType<typeof fakeServer>;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "tefnotes-data-"));
  srv = fakeServer();
  mkdirSync(join(root, "state/tefnotes"), { recursive: true });
  writeFileSync(join(root, "state/tefnotes/server.json"), JSON.stringify({ url: srv.url }));
  writeFileSync(join(root, "scene.excalidraw"), SCENE);
});
afterEach(() => { srv.stop(); rmSync(root, { recursive: true, force: true }); });

async function cli(args: string[], stdin = "", extra: Record<string, string> = {}) {
  const env: Record<string, string | undefined> = { ...process.env, XDG_STATE_HOME: join(root, "state"), ...extra };
  delete env.EDITOR; delete env.VISUAL; delete env.TEF_NOTES_AGENT;
  Object.assign(env, extra);
  const p = Bun.spawn(["bun", CLI, ...args], { cwd: root, env, stdin: new Blob([stdin]), stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { out: out.trim(), err: err.trim(), code };
}
const notes = () => [...srv.records("notes").values()];
const tasks = () => [...srv.records("tasks").values()];

describe("a lost reply", () => {
  test("`new` is sent again under its own id: one note, not two", async () => {
    let lost = true;
    srv.faults.lose = (w) => (lost && w.method === "POST" && w.collection === "notes" ? !(lost = false) : false);
    const r = await cli(["new", "Idea"], "body\n");
    expect(r.code, r.err).toBe(0);
    expect(notes().length).toBe(1);
    expect(r.out).toBe(notes()[0].path.replace(/^notes\//, "").replace(/\.md$/, ""));
    const posts = srv.writes.filter((w) => w.method === "POST" && w.collection === "notes");
    expect(posts.length).toBe(2);
    expect(posts[1].body.id).toBe(posts[0].body.id);     // the same record id, never a new one
  });

  test("`add` is sent again under its own id: one task, not two", async () => {
    let lost = true;
    srv.faults.lose = (w) => (lost && w.method === "POST" && w.collection === "tasks" ? !(lost = false) : false);
    const r = await cli(["add", "Buy milk"]);
    expect(r.code, r.err).toBe(0);
    expect(tasks().length).toBe(1);
    expect(r.out).toBe(tasks()[0].id);
  });

  test("`append` whose reply was lost does not add its text a second time", async () => {
    const id = (await cli(["new", "Log"], "first\n")).out;
    let lost = true;
    srv.faults.lose = (w) => (lost && w.method === "PATCH" && w.collection === "notes" ? !(lost = false) : false);
    const r = await cli(["append", id], "second line\n");
    expect(r.code, r.err).toBe(0);
    const text: string = notes()[0].text;
    expect(text.split("second line").length - 1).toBe(1);
    expect(notes()[0].rev).toBe(2);
  });
});

describe("`put`", () => {
  test("refuses an empty stdin instead of writing an empty note over the text", async () => {
    const id = (await cli(["new", "Keep"], "precious\n")).out;
    for (const nothing of ["", "  \n"]) {
      const r = await cli(["put", id, "1"], nothing);
      expect(r.code).toBe(1);
      expect(r.err).toContain("nothing on stdin");
    }
    expect(notes()[0].text).toContain("precious");
    expect(notes()[0].rev).toBe(1);
  });
});

describe("`done` on a repeating task", () => {
  test("makes the next round before it ticks, so a failed create loses nothing", async () => {
    const id = (await cli(["add", "Water", "--when", "today", "--every", "1d"])).out;
    srv.faults.refuse = (w) => (w.method === "POST" && w.collection === "tasks" ? 500 : undefined);
    const first = await cli(["done", id]);
    expect(first.code).toBe(1);
    srv.faults.refuse = undefined;
    expect(tasks().find((t) => t.id === id)!.done).toBe("");       // not ticked: the round it would have rolled into doesn't exist
    const again = await cli(["done", id]);
    expect(again.code, again.err).toBe(0);
    expect(tasks().length).toBe(2);
    expect(tasks().find((t) => t.id === id)!.done).not.toBe("");
    expect(tasks().filter((t) => t.done === "").length).toBe(1);
  });

  test("run again after the tick's reply was lost, it ticks nothing twice and makes no second round", async () => {
    const id = (await cli(["add", "Water", "--when", "today", "--every", "1d"])).out;
    srv.faults.lose = (w) => w.method === "PATCH" && w.collection === "tasks";
    expect((await cli(["done", id])).code).toBe(1);               // the tick landed, its answer didn't
    srv.faults.lose = undefined;
    const again = await cli(["done", id]);
    expect(again.err).toContain("already done");
    expect(tasks().length).toBe(2);
  });
});

describe("`draw --replace`", () => {
  const drawn = async () => {
    const id = (await cli(["new", "Plan"], "text\n")).out;
    const name = (await cli(["draw", id, "scene.excalidraw", "--label", "Flow"])).out;
    return { id, name };
  };
  const files = () => [...srv.records("attachments").values()].map((a) => a.name).sort();

  test("puts the new scene up and moves the note's link to it before the old files go", async () => {
    const { id, name } = await drawn();
    const r = await cli(["draw", id, "scene.excalidraw", "--replace", name]);
    expect(r.code, r.err).toBe(0);
    expect(r.out).not.toBe(name);
    expect(files()).toEqual([r.out.replace(/\.excalidraw$/, ".png"), r.out].sort());
    expect(notes()[0].text).toContain(`/${r.out})`);
    expect(notes()[0].text).not.toContain(`/${name})`);
  });

  test("a failure on the way leaves the old drawing in place and linked, and nothing of the new one", async () => {
    const { id, name } = await drawn();
    const before = notes()[0].text;
    srv.faults.refuse = (w) => (w.method === "PATCH" && w.collection === "notes" ? 500 : undefined);
    const r = await cli(["draw", id, "scene.excalidraw", "--replace", name]);
    expect(r.code).toBe(1);
    expect(files()).toEqual([name.replace(/\.excalidraw$/, ".png"), name].sort());
    expect(notes()[0].text).toBe(before);
  });
});

describe("`edit`", () => {
  const editor = (script: string) => {
    const file = join(root, "editor.sh");
    writeFileSync(file, `#!/bin/sh\n${script}\n`);
    chmodSync(file, 0o755);
    return { VISUAL: file, SEEN: join(root, "seen") };
  };

  test("edits a file only its owner can read, and removes it once saved", async () => {
    const id = (await cli(["new", "Secret"], "words\n")).out;
    const env = editor('echo "$1" > "$SEEN"; stat -c %a "$1" >> "$SEEN"; stat -c %a "$(dirname "$1")" >> "$SEEN"; echo "an edit" >> "$1"');
    const r = await cli(["edit", id], "", env);
    expect(r.code, r.err).toBe(0);
    const [file, fileMode, dirMode] = readFileSync(env.SEEN, "utf8").trim().split("\n");
    expect(fileMode).toBe("600");
    expect(dirMode).toBe("700");
    expect(file).not.toContain(`tefnotes-${id}`);              // no predictable name
    expect(existsSync(file)).toBe(false);
    expect(notes()[0].text).toContain("an edit");
  });

  test("keeps the text and names the file when an overlapping edit meanwhile refuses it", async () => {
    const id = (await cli(["new", "Clash"], "one line\n")).out;
    const rec = notes()[0];
    const env = editor(`echo "$1" > "$SEEN"
curl -s -X PATCH -H 'content-type: application/json' -d '{"rev":1,"text":"${JSON.stringify(rec.text.replace("one line", "THEIRS")).slice(1, -1)}"}' "${srv.url}/api/collections/notes/records/${rec.id}" > /dev/null
sed -i 's/one line/MINE/' "$1"`);
    const r = await cli(["edit", id], "", env);
    expect(r.code).toBe(1);
    const file = readFileSync(env.SEEN, "utf8").trim();
    expect(r.err).toContain(`your text is in ${file}`);
    expect(readFileSync(file, "utf8")).toContain("MINE");
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  test("keeps the text and names the file when the merged save is refused too", async () => {
    const id = (await cli(["new", "Twice"], "one\n\ntwo\n")).out;
    const rec = notes()[0];
    const theirs = JSON.stringify(rec.text.replace("two", "two (theirs)")).slice(1, -1);
    const env = editor(`echo "$1" > "$SEEN"
curl -s -X PATCH -H 'content-type: application/json' -d '{"rev":1,"text":"${theirs}"}' "${srv.url}/api/collections/notes/records/${rec.id}" > /dev/null
sed -i 's/one/one (mine)/' "$1"`);
    let patches = 0;
    srv.faults.refuse = (w) => (w.method === "PATCH" && w.collection === "notes" && ++patches === 3 ? 409 : undefined);   // 1: theirs; 2: mine (stale); 3: the merge
    const r = await cli(["edit", id], "", env);
    expect(r.code).toBe(1);
    const file = readFileSync(env.SEEN, "utf8").trim();
    expect(r.err).toContain(`your text is in ${file}`);
    expect(existsSync(file)).toBe(true);
  });
});

describe("`grep`", () => {
  test("says when the list was cut at 20", async () => {
    for (let i = 0; i < 25; i++) srv.records("notes").set(`n${i}`.padEnd(15, "0"), { id: `n${i}`.padEnd(15, "0"), path: `notes/2026-11-0${i % 9}-n${i}.md`, text: `# Note ${i}\n`, rev: 1, kind: "note" });
    const r = await cli(["grep", "note"]);
    expect(r.code, r.err).toBe(0);
    expect(r.out.split("\n").length).toBe(20);
    expect(r.err).toContain("only the first 20 matches");
  });

  test("says nothing when everything fit", async () => {
    srv.records("notes").set("n1".padEnd(15, "0"), { id: "n1".padEnd(15, "0"), path: "notes/a.md", text: "# One\n", rev: 1, kind: "note" });
    const r = await cli(["grep", "one"]);
    expect(r.out.split("\n").length).toBe(1);
    expect(r.err).toBe("");
  });
});
