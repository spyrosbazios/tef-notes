import { describe, expect, it, test } from "bun:test";
import { absorbTags, allTagNames, dropTyping, GUESS_DELAY, guessTags, liveTags, tagGuesser, matchesTask, parseTagQuery, suggestTags, typingTag, undefinedTags, type TagDef } from "../src/tags";
import { newTask } from "../src/todo";

const def = (name: string): TagDef => ({ rec: name, name, description: "" });

describe("parseTagQuery", () => {
  it("splits #tags from the words, and ignores a lone #", () => {
    expect(parseTagQuery("#home keys # #Ωραία")).toEqual({ tags: ["home", "Ωραία"], text: "keys" });
  });
});

describe("tag being typed", () => {
  it("is the trailing #word, until a space finishes it", () => {
    expect(typingTag("keys #ho")).toBe("ho");
    expect(typingTag("#")).toBe("");
    expect(typingTag("keys #home ")).toBeNull();
    expect(typingTag("keys")).toBeNull();
    expect(typingTag("a#b")).toBeNull();
  });
  it("is dropped from the text when picked", () => {
    expect(dropTyping("keys #ho")).toBe("keys ");
    expect(dropTyping("#")).toBe("");
    expect(dropTyping("keys")).toBe("keys");
  });
  it("turns finished #words into chips and leaves the one being typed", () => {
    expect(absorbTags("#home keys #ke")).toEqual({ done: ["home"], text: "keys #ke" });
    expect(absorbTags("a #home #work b ")).toEqual({ done: ["home", "work"], text: "a b " });
    expect(absorbTags("keys #ho")).toEqual({ done: [], text: "keys #ho" });
    expect(absorbTags("# keys")).toEqual({ done: [], text: "# keys" });
  });
});

describe("allTagNames", () => {
  it("lists definitions first, then others in use, one per name ignoring case and tonos", () => {
    expect(allTagNames([def("work"), def("Σπίτι")], [["σπιτι", "zeta"], ["Work", "alpha"], []])).toEqual(["work", "Σπίτι", "alpha", "zeta"]);
  });
});

describe("suggestTags", () => {
  const names = ["home", "work", "photos", "Ωραία"];
  it("puts prefix matches before substrings, folded", () => {
    expect(suggestTags(["photos", "work", "ox"], "#o")).toEqual(["ox", "photos", "work"]);
    expect(suggestTags(names, "ωραια")).toEqual(["Ωραία"]);
    expect(suggestTags(names, "ho")).toEqual(["home", "photos"]);
  });
  it("leaves out names already on the note, and caps", () => {
    expect(suggestTags(names, "", ["HOME"])).toEqual(["work", "photos", "Ωραία"]);
    expect(suggestTags(names, "", [], 2)).toEqual(["home", "work"]);
  });
});

describe("matchesTask", () => {
  it("folds Greek tonos and combines all words with tag prefixes, including completed tasks", () => {
    const task = newTask("task1", { title: "Αγορά καφέ", notes: "From the corner shop", tags: ["errands"], done: "2026-01-01" });
    expect(matchesTask("καφε corner #err")(task)).toBe(true);
    expect(matchesTask("καφε missing")(task)).toBe(false);
    expect(matchesTask("#home")(task)).toBe(false);
    expect(matchesTask("")(task)).toBe(true);
  });
});

describe("undefinedTags", () => {
  it("lists the tags in use with no definition, counted once per item, ignoring case and tonos", () => {
    expect(undefinedTags([def("work")], [["Work", "zeta", "Zeta"], ["ζήτα", "zeta"], ["alpha"], []]))
      .toEqual([{ name: "alpha", count: 1 }, { name: "zeta", count: 2 }, { name: "ζήτα", count: 1 }]);
  });
});

describe("tags guessed while a task is typed", () => {
  test("liveTags keeps hand-added tags, swaps the old guess for the new, never brings back a dismissed one", () => {
    expect(liveTags([], [], ["work"], [])).toEqual(["work"]);
    expect(liveTags(["home", "work"], ["work"], ["chores"], [])).toEqual(["home", "chores"]);
    expect(liveTags(["Home"], [], ["home", "work"], [])).toEqual(["Home", "work"]);
    expect(liveTags([], ["work"], ["work", "coding"], ["Work"])).toEqual(["coding"]);
  });

  test("tagGuesser asks once, after the typing stops, and drops a stale answer", async () => {
    const calls: string[] = [];
    let tags: string[] = ["mine"];
    const real = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      calls.push(JSON.parse(String(init.body)).title);
      return new Response(JSON.stringify({ tags: ["work"] }), { status: 200 });
    }) as typeof fetch;
    try {
      const g = tagGuesser((d, signal) => guessTags({ url: "http://pb" } as never, d, signal), (f) => { tags = f(tags); });
      g.update("ab", "");                     // too short
      g.update("Email", ""); g.update("Email the client", "");
      await new Promise((r) => setTimeout(r, GUESS_DELAY + 100));
      g.update("Email the client ", "");       // same draft once trimmed: not asked again
      await new Promise((r) => setTimeout(r, GUESS_DELAY + 100));
      expect(calls).toEqual(["Email the client"]);
      expect(tags).toEqual(["mine", "work"]);
      g.dismiss("work");
      g.update("Email the boss", "");
      await new Promise((r) => setTimeout(r, GUESS_DELAY + 100));
      expect(tags).toEqual(["mine"]);
      g.update("Call mum", ""); g.stop();
      await new Promise((r) => setTimeout(r, GUESS_DELAY + 100));
      expect(calls).toHaveLength(2);
    } finally {
      globalThis.fetch = real;
    }
  });
});
