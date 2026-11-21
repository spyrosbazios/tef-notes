// What `tefnotes` puts on the wire. With TEF_NOTES_AGENT=1 every write that carries content must say whose it is: a note or
// task `tainted`, a tag description `describedBy: "agent"` (SEC-5). The CLI runs for real, against a fake server that logs
// every write; without the variable nothing may carry either mark.
import { beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeServer, type Write } from "./fake-server";

const CLI = join(import.meta.dir, "..", "tefnotes.ts");
const SCENE = JSON.stringify({ type: "excalidraw", version: 2, elements: [{ id: "a", type: "rectangle", x: 0, y: 0, width: 10, height: 10 }] });

const content = (w: Write) => (w.method === "POST" || w.method === "PATCH") && ["notes", "tasks", "tags"].includes(w.collection);

/** Every note, task and tag a write touched must carry the mark the environment asks for, and none when it doesn't. */
function assertMarks(writes: Write[], agent: boolean, tagsMarked: number) {
  const rec = writes.filter(content);
  for (const w of rec.filter((x) => x.collection !== "tags")) expect(w.body.tainted, `${w.method} ${w.collection}`).toBe(agent ? true : undefined);
  const tags = rec.filter((x) => x.collection === "tags");
  expect(tags.filter((w) => w.body.describedBy === "agent").length).toBe(agent ? tagsMarked : 0);
  for (const w of tags) expect(w.body.describedBy === undefined || w.body.describedBy === "agent").toBe(true);
}

async function scenario(agent: boolean) {
  const root = mkdtempSync(join(tmpdir(), "tefnotes-marks-")), srv = fakeServer();
  try {
    mkdirSync(join(root, "state/tefnotes"), { recursive: true });
    writeFileSync(join(root, "state/tefnotes/server.json"), JSON.stringify({ url: srv.url }));
    const editor = join(root, "editor.sh");
    writeFileSync(editor, '#!/bin/sh\necho "an edit" >> "$1"\n');
    chmodSync(editor, 0o755);
    writeFileSync(join(root, "scene.excalidraw"), SCENE);
    mkdirSync(join(root, "md"));
    writeFileSync(join(root, "md/imported.md"), "# Imported\n\n![pic](pic.png)\n");
    writeFileSync(join(root, "md/pic.png"), "png");

    const env: Record<string, string | undefined> = { ...process.env, XDG_STATE_HOME: join(root, "state"), VISUAL: editor, TEF_NOTES_AGENT: agent ? "1" : undefined };
    delete env.EDITOR;
    const steps: { name: string; writes: Write[]; out: string }[] = [];
    const run = async (name: string, args: string[], stdin = "") => {
      const before = srv.writes.length;
      const p = Bun.spawn(["bun", CLI, ...args], { cwd: root, env, stdin: new Blob([stdin]), stdout: "pipe", stderr: "pipe" });
      const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
      expect(code, `${name}: ${err}`).toBe(0);
      steps.push({ name, writes: srv.writes.slice(before), out: out.trim() });
      return out.trim();
    };

    const id = await run("new", ["new", "Marked note"], "first body\n");
    await run("append", ["append", id], "appended line\n");
    await run("put", ["put", id, "2"], "# Marked note\n\nwhole file\n");
    await run("edit", ["edit", id]);
    const drawn = await run("draw", ["draw", id, "scene.excalidraw", "--label", "Flow"]);
    await run("draw --replace", ["draw", id, "scene.excalidraw", "--replace", drawn]);
    await run("import", ["import", join(root, "md")]);
    writeFileSync(join(root, "md/imported.md"), "# Imported\n\n![pic](pic.png)\n\nchanged\n");
    await run("import --update", ["import", join(root, "md"), "--update"]);
    const task = await run("add", ["add", "Marked task", "--when", "today", "--every", "1d", "--note", id, "--tag", "work"]);
    await run("set", ["set", task, "--title", "Marked task, renamed"]);
    await run("done", ["done", task]);
    await run("tag new", ["tag", "work", "--about", "work things"]);
    await run("tag colour", ["tag", "work", "--color", "red"]);
    await run("tag about", ["tag", "work", "--about", "work, again"]);
    await run("tag bare", ["tag", "play"]);
    await run("tags --describe --write", ["tags", "--describe", "--write"]);
    return { steps, writes: srv.writes };
  } finally {
    srv.stop();
    rmSync(root, { recursive: true, force: true });
  }
}

const has = (steps: { name: string; writes: Write[] }[], name: string) => steps.find((s) => s.name === name)!.writes;
const patches = (ws: Write[], collection: string) => ws.filter((w) => w.method === "PATCH" && w.collection === collection);

describe("TEF_NOTES_AGENT=1", () => {
  let r: Awaited<ReturnType<typeof scenario>>;
  beforeAll(async () => { r = await scenario(true); }, 120_000);

  test("every note, task and tag description written carries the mark", () => {
    // tag about, tag new, and the two descriptions `tags --describe --write` saves (work, play): `tag colour` and `tag bare` write none
    assertMarks(r.writes, true, 4);
  });

  test("each command that writes content wrote it", () => {
    for (const [name, collection, method] of [
      ["new", "notes", "POST"], ["append", "notes", "PATCH"], ["put", "notes", "PATCH"], ["edit", "notes", "PATCH"],
      ["draw", "notes", "PATCH"], ["import", "notes", "POST"], ["import --update", "notes", "PATCH"],
      ["add", "tasks", "POST"], ["set", "tasks", "PATCH"], ["done", "tasks", "PATCH"], ["done", "tasks", "POST"],
      ["tag new", "tags", "POST"], ["tag about", "tags", "PATCH"], ["tags --describe --write", "tags", "PATCH"],
    ] as const) expect(has(r.steps, name).some((w) => w.collection === collection && w.method === method), `${name}: ${method} ${collection}`).toBe(true);
  });

  test("draw --replace marks the note in the write that moves its link, before the old scene goes", () => {
    const ws = has(r.steps, "draw --replace"), mark = ws.findIndex((w) => w.collection === "notes" && w.method === "PATCH" && w.body.tainted === true);
    const old = ws.findIndex((w) => w.collection === "attachments" && w.method === "DELETE");
    expect(mark).toBeGreaterThanOrEqual(0);
    expect(old).toBeGreaterThan(mark);
  });

  test("a tag change that leaves the description alone does not claim it", () => {
    expect(has(r.steps, "tag colour").filter(content).every((w) => w.body.describedBy === undefined)).toBe(true);
  });

  test("a tag made without a description is not marked", () => {
    expect(has(r.steps, "tag bare").filter(content).every((w) => w.body.describedBy === undefined)).toBe(true);
  });
});

describe("without TEF_NOTES_AGENT", () => {
  test("nothing carries a mark, and draw --replace writes the note once, to move its link", async () => {
    const r = await scenario(false);
    assertMarks(r.writes, false, 0);
    expect(patches(has(r.steps, "draw --replace"), "notes").length).toBe(1);
  }, 120_000);
});

describe("tefnotes.ts", () => {
  const source = readFileSync(CLI, "utf8");

  test("writes notes, tasks and tags only through writes.ts", () => {
    // pb.update, pb.create, pb.tasks.create/update, createTag, updateTag and importNotes each take the mark as an argument:
    // a call outside `writer` is a write somebody can forget to mark.
    expect(source.match(/\bpb\.(create|update)\(|\bpb\.tasks\.(create|update)\(|import \{[^}]*\b(createTag|updateTag|importNotes)\b/g)).toBeNull();
  });
});
