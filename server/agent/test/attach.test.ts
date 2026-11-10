// attach_file: a file attached in the chat filed into a note, against a fake PocketBase (fake-pb.ts).
import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { attachedBlock, attachedFiles, type Attached } from "@/core/assistant";
import { parseNote } from "@/core/notes";
import { approvals } from "../src/agent";
import { bytesOf } from "../src/fileTools";
import { Notes } from "../src/notes";
import { Todo } from "../src/todo";
import { tools } from "../src/tools";
import { fakePb } from "./fake-pb";

const pb = fakePb();
afterAll(() => pb.stop());

const b64 = (s: string) => Buffer.from(s).toString("base64");
const pic: Attached = { name: "receipt.jpg", mediaType: "image/jpeg", url: `data:image/jpeg;base64,${b64("JPEG")}` };
const pdf: Attached = { name: "Lease 2026.pdf", mediaType: "application/pdf", url: `data:application/pdf;base64,${b64("%PDF")}` };
const file = (title: string, body = "- x\n") => `---\ntitle: ${title}\ncreated: 2026-10-01\n---\n${body}`;
const run = (T: ReturnType<typeof tools>, i: object) => T.attach_file.execute!(i as never, { toolCallId: "c", messages: [] } as never) as Promise<any>;

let notes: Notes, T: ReturnType<typeof tools>;
beforeEach(() => {
  pb.notes.clear(); pb.attachments.clear(); pb.created.length = 0;
  notes = new Notes({ url: pb.url });
  T = tools(notes, new Todo({ url: pb.url }), undefined, [pic, pdf]);
});

describe("attachedFiles", () => {
  it("the owner's file parts, oldest first, a name used twice kept by its newest", () => {
    const m = (parts: object[], role = "user") => ({ role, parts });
    const files = attachedFiles([
      m([{ type: "text", text: "hi" }, { type: "file", mediaType: "image/jpeg", filename: "a.jpg", url: "data:,1" }]),
      m([{ type: "file", mediaType: "image/jpeg", filename: "x.jpg", url: "data:,no" }], "assistant"),
      m([{ type: "file", mediaType: "application/pdf", filename: "b.pdf", url: "data:,2" }, { type: "file", mediaType: "image/jpeg", filename: "a.jpg", url: "data:,3" }]),
    ]);
    expect(files.map((f) => [f.name, f.url])).toEqual([["b.pdf", "data:,2"], ["a.jpg", "data:,3"]]);
    expect(attachedBlock(files)).toBe("<attached>\nb.pdf (PDF)\na.jpg (picture)\n</attached>");
    expect(attachedBlock([])).toBe("");
  });
  it("bytesOf: base64 and plain data URLs", () => {
    expect(new TextDecoder().decode(bytesOf(pic.url)!)).toBe("JPEG");
    expect(new TextDecoder().decode(bytesOf("data:,a%20b")!)).toBe("a b");
    expect(bytesOf("https://x")).toBeNull();
  });
});

describe("attach_file", () => {
  it("into an existing note: uploaded under its id, the line and the picture added, the write tainted", async () => {
    pb.put("notes/a.md", file("Receipts"));
    const r = await run(T, { file: "receipt.jpg", path: "notes/a.md", text: "Groceries, 12 €" });
    expect(r).toMatchObject({ saved: "notes/a.md" });
    const n = pb.notes.get("notes/a.md")!, id = parseNote("notes/a.md", n.text).id;
    const [a] = [...pb.attachments.values()];
    expect(a).toMatchObject({ note: id });
    expect(new TextDecoder().decode(a.bytes)).toBe("JPEG");
    expect(n.text).toContain(`- x\n\nGroceries, 12 €\n![](../attachments/${id}/${a.name})\n`);
    expect(n.tainted).toBe(true);
  });

  it("a PDF into a new note: titled, the line first, linked by its original name", async () => {
    const r = await run(T, { file: "Lease 2026.pdf", title: "Lease", text: "The flat's lease." });
    expect(r.saved).toMatch(/^notes\/.+\.md$/);
    const n = pb.notes.get(r.saved)!, id = parseNote(r.saved, n.text).id;
    expect(n.text).toContain(`title: Lease`);
    expect(n.text).toContain(`The flat's lease.\n\n[Lease 2026.pdf](../attachments/${id}/lease-2026.pdf)\n`);
    expect([...pb.attachments.values()].map((a) => a.name)).toEqual(["lease-2026.pdf"]);
  });

  it("a bad call goes back to the agent without a card", async () => {
    const ask = approvals(notes, new Todo({ url: pb.url }), false, undefined, [pic]);
    pb.put("notes/a.md", file("A"));
    expect(await run(T, { file: "nope.png", path: "notes/a.md" })).toMatchObject({ error: expect.stringContaining("receipt.jpg") });
    expect(await run(T, { file: "receipt.jpg" })).toMatchObject({ error: expect.stringContaining("either path") });
    expect(await ask.attach_file({ file: "receipt.jpg", path: "notes/nope.md" })).toBe("not-applicable");
    expect(await ask.attach_file({ file: "receipt.jpg", path: "notes/a.md" })).toBe("user-approval");
    expect(pb.attachments.size).toBe(0);
  });
});
