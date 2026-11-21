// The drawing editor's life: unsaved strokes are never dropped without asking, and one save runs at a time.
import { describe, expect, test } from "bun:test";
import { drawingStore, type Saved } from "@/lib/drawing-store";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("closing", () => {
  test("nothing unsaved: it closes at once", async () => {
    const d = drawingStore();
    const at = await d.open("n1", "drawing-1.excalidraw");
    expect(at).toBe(1);
    expect(await d.requestClose()).toBe(true);
    expect(d.get().opened).toBeNull();
  });

  test("unsaved: it asks, and every caller waiting gets the owner's answer", async () => {
    const d = drawingStore();
    const at = (await d.open("n1", null))!;
    d.markUnsaved(at, true);
    const button = d.requestClose(), away = d.requestClose();
    expect(d.get().asking).toBe(true);
    expect(d.get().opened).not.toBeNull();
    d.answer(false);
    expect(await button).toBe(false);
    expect(await away).toBe(false);
    expect(d.get()).toMatchObject({ asking: false, unsaved: true, opened: { noteId: "n1" } });
  });

  test("closing without saving closes it", async () => {
    const d = drawingStore();
    d.markUnsaved((await d.open("n1", null))!, true);
    const asked = d.requestClose();
    d.answer(true);
    expect(await asked).toBe(true);
    expect(d.get()).toMatchObject({ opened: null, unsaved: false, asking: false });
  });

  test("another drawing opening over unsaved strokes asks first, and the owner can keep them", async () => {
    const d = drawingStore();
    const first = (await d.open("n1", null))!;
    d.markUnsaved(first, true);
    const second = d.open("n2", "drawing-1.excalidraw");
    await tick();
    expect(d.get().asking).toBe(true);
    d.answer(false);
    expect(await second).toBeNull();
    expect(d.get().opened?.seq).toBe(first);
  });

  test("a canvas that went says so: an unsaved flag from an older opening is ignored", async () => {
    const d = drawingStore();
    const old = (await d.open("n1", null))!;
    await d.open("n1", null);
    d.markUnsaved(old, true);
    expect(d.get().unsaved).toBe(false);
  });
});

describe("saving", () => {
  test("a second save while one runs is the same save: a held ⌘S, or ⌘S beside save_drawing, makes one drawing", async () => {
    const d = drawingStore();
    const at = (await d.open("n1", null))!;
    d.markUnsaved(at, true);
    const made: (string | null)[] = [];
    let finish!: (r: Saved) => void;
    d.setSaver({ seq: at, save: (name) => { made.push(name); return new Promise<Saved>((r) => { finish = r; }); } });
    const key = d.save(), tool = d.save();
    expect(d.get().saving).toBe(true);
    finish({ name: "drawing-1.excalidraw" });
    expect(await key).toEqual({ name: "drawing-1.excalidraw" });
    expect(await tool).toEqual({ name: "drawing-1.excalidraw" });
    expect(made).toEqual([null]);
    expect(d.get().saving).toBe(false);
  });

  test("a save after it uses the name the first gave, and uploads nothing when nothing changed", async () => {
    const d = drawingStore();
    const at = (await d.open("n1", null))!;
    d.markUnsaved(at, true);
    const made: (string | null)[] = [];
    d.setSaver({ seq: at, save: async (name) => { made.push(name); d.savedAs("drawing-1.excalidraw"); d.markUnsaved(at, false); return { name: "drawing-1.excalidraw" }; } });
    await d.save();
    expect(await d.save()).toEqual({ name: "drawing-1.excalidraw" });
    d.markUnsaved(at, true);
    await d.save();
    expect(made).toEqual([null, "drawing-1.excalidraw"]);
  });

  test("a failed save ends, and the next one runs", async () => {
    const d = drawingStore();
    const at = (await d.open("n1", null))!;
    d.markUnsaved(at, true);
    let calls = 0;
    d.setSaver({ seq: at, save: async () => (++calls === 1 ? { error: "Not saved: offline" } : { name: "drawing-1.excalidraw" }) });
    expect(await d.save()).toEqual({ error: "Not saved: offline" });
    expect(await d.save()).toEqual({ name: "drawing-1.excalidraw" });
    expect(d.get().saving).toBe(false);
  });

  test("no Save for an opening that isn't the open one", async () => {
    const d = drawingStore();
    d.setSaver({ seq: 99, save: async () => ({ name: "x" }) });
    expect(await d.save()).toEqual({ error: "No drawing is open." });
  });
});
