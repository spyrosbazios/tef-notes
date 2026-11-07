// The auto-tagger's lib (pb_hooks/lib/autotag.js): what it asks JEV and does with the answers. The `tags:` line it writes
// is lib/notes.js's, checked against the clients' in notes.test.js.
import { describe, expect, test } from "bun:test";
import lib from "../pb_hooks/lib/autotag.js";
import notes from "../pb_hooks/lib/notes.js";

describe("names", () => {
  test("folded: case and Greek tonos", () => {
    expect(notes.fold("ΈΡΓΟ")).toBe("εργο");
    expect(lib.without(["Home", "Work", "work", "Έργο"], ["home", "εργο"])).toEqual(["Work"]);
  });
  test("definitions' hash moves with a name or a description, not with their order", () => {
    const a = { name: "Food", description: "recipes" }, b = { name: "Work", description: "" };
    expect(lib.defsHash([a, b])).toBe(lib.defsHash([b, a]));
    expect(lib.defsHash([a, b])).not.toBe(lib.defsHash([a, { ...b, description: "jobs" }]));
    expect(lib.defsHash([a, b])).not.toBe(lib.defsHash([a]));
    expect(lib.defsHash([a])).toMatch(/^[0-9a-f]{8}$/);
  });
  test("the evaluated state", () => expect(lib.taggedKey(3, "ab12cd34")).toBe("3:ab12cd34"));
});

describe("asking", () => {
  const defs = Array.from({ length: 45 }, (_, i) => ({ name: `T${i}`, description: i === 0 ? " the zeroth " : "" }));
  const note = { title: "Garage door codes", body: "x".repeat(20000) };
  test("20 questions to a request, the body capped, the shape documented at docs.typesafe.ai", () => {
    const rs = lib.requests(note, defs);
    expect(rs.map((r) => Object.keys(r.body.questions).length)).toEqual([20, 20, 5]);
    expect(rs[0].body.model).toBe("jev-1.13.0");
    expect(rs[0].body.state.text.length).toBe(12000);
    expect(rs[0].body.state.title).toBe("Garage door codes");
    expect(rs[0].body.questions.t0).toEqual({
      type: "noul",
      instructions: 'Should this note carry the tag "T0"? The tag means: the zeroth',
      criteria: { true: 'The note belongs under "T0".', false: 'The note does not belong under "T0".' },
    });
    expect(rs[2].body.questions.t4.instructions).toContain('"T44"');
  });
  test("answers are matched to their question; a missing or malformed one is dropped", () => {
    const [r] = lib.requests(note, defs.slice(0, 3));
    expect(lib.probabilities(r.defs, { answers: { t0: { noul: 0.9 }, t1: { noul: "x" }, t2: { noul: 0 } } })).toEqual([{ name: "T0", p: 0.9 }, { name: "T2", p: 0 }]);
    expect(lib.probabilities(r.defs, {})).toEqual([]);
  });
  test("0.5 and up adds, likeliest first; below that does nothing", () => {
    const ps = [{ name: "a", p: 0.5 }, { name: "b", p: 0.85 }, { name: "c", p: 0.8499 }, { name: "d", p: 0.4999 }, { name: "e", p: 1 }];
    expect(lib.decide(ps)).toEqual(["e", "b", "c", "a"]);
  });
});

describe("tasks", () => {
  const defs = [{ name: "Home", description: "the house" }];
  test("a task is its title and, as the text, its notes", () => {
    expect(lib.taskItem({ title: "Fix tap", notes: " Call Nikos " })).toEqual({ kind: "task", title: "Fix tap", body: "Call Nikos" });
    expect(lib.taskItem({ title: "Loose" })).toEqual({ kind: "task", title: "Loose", body: "" });
  });
  test("a guess body is a title and optional notes, cut to GUESS_CHARS together", () => {
    expect(lib.guessInput({ title: " Buy milk ", notes: "2L" })).toEqual({ title: "Buy milk", notes: "2L" });
    expect(lib.guessInput({ title: "x" })).toEqual({ title: "x", notes: "" });
    expect(lib.guessInput({ title: 3 })).toBeNull();
    expect(lib.guessInput({ title: "x", notes: 3 })).toBeNull();
    expect(lib.guessInput(null)).toBeNull();
    const big = lib.guessInput({ title: "t".repeat(3000), notes: "n".repeat(3000) });
    expect(big.title.length + big.notes.length).toBe(lib.GUESS_CHARS);
  });
  test("the questions say task, in the same shape; a note's are unchanged", () => {
    const [r] = lib.requests(lib.taskItem({ title: "Fix tap", notes: "n" }), defs);
    expect(r.body.state).toEqual({ title: "Fix tap", text: "n" });
    expect(r.body.questions.t0).toEqual({
      type: "noul",
      instructions: 'Should this task carry the tag "Home"? The tag means: the house',
      criteria: { true: 'The task belongs under "Home".', false: 'The task does not belong under "Home".' },
    });
    expect(lib.requests({ title: "N", body: "b" }, defs)[0].body.questions.t0.instructions).toStartWith('Should this note carry');
  });
});

describe("photos", () => {
  const defs = Array.from({ length: 25 }, (_, i) => ({ name: `T${i}`, description: "" }));
  const note = { title: "Receipt", body: "Lunch\n\n![till](../attachments/n/a.jpg)" };
  const photos = [
    { ref: "photo-aaa", format: "jpg", data: "QUJD", caption: "till" },
    { ref: "photo-bbb", format: "png", data: "REVG", caption: "" },
  ];
  test("a note without photos asks exactly what it always did", () => {
    const plain = lib.requests(note, defs.slice(0, 2));
    expect(plain).toEqual(lib.requests(note, defs.slice(0, 2), []));
    expect(JSON.stringify(plain[0].body)).toBe(JSON.stringify({
      model: "jev-1.13.0",
      state: { title: "Receipt", text: note.body },
      questions: {
        t0: { type: "noul", instructions: 'Should this note carry the tag "T0"?', criteria: { true: 'The note belongs under "T0".', false: 'The note does not belong under "T0".' } },
        t1: { type: "noul", instructions: 'Should this note carry the tag "T1"?', criteria: { true: 'The note belongs under "T1".', false: 'The note does not belong under "T1".' } },
      },
    }));
    expect(plain[0].body.assets).toBeUndefined();
  });
  test("photos: refs in the state, the images as assets, in every request", () => {
    const rs = lib.requests(note, defs, photos);
    expect(rs.length).toBe(2);
    for (const r of rs) {
      expect(r.body.state.photos).toEqual([{ picture: "photo-aaa", caption: "till" }, { picture: "photo-bbb" }]);
      expect(r.body.assets).toEqual({
        "photo-aaa": { type: "image", format: "jpg", data_base64: "QUJD" },
        "photo-bbb": { type: "image", format: "png", data_base64: "REVG" },
      });
      expect(r.body.questions.t0.instructions).toContain("The note's photos are part of it.");
      expect(r.body.state.text).toBe(note.body);
    }
  });
  test("every asset is referenced from the state, as TypeSafe requires", () => {
    const [r] = lib.requests(note, defs, photos), state = JSON.stringify(r.body.state);
    for (const ref of Object.keys(r.body.assets)) expect(state).toContain(ref);
  });
  test("at most three photos are the hook's to send", () => expect(lib.PHOTOS).toBe(3));
  test("the evaluated-at marker keeps its shape", () => expect(lib.taggedKey(7, "0badcafe")).toBe("7:0badcafe"));
});
