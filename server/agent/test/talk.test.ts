import { describe, expect, test } from "bun:test";
import { turnsOf, wordsOf } from "../src/talk";

describe("wordsOf", () => {
  test("says a whole sentence at once, and keeps what follows", () => {
    expect(wordsOf("Let me look at that. I'll be a moment.")).toEqual({ say: "Let me look at that. I'll be a moment.", rest: "" });
    expect(wordsOf("Let me look at that. and then")).toEqual({ say: "Let me look at that.", rest: " and then" });
  });

  test("waits for a sentence long enough to sound like one", () => {
    expect(wordsOf("Hi. Let me")).toBeNull();
    expect(wordsOf("no breaks here at all")).toBeNull();
    expect(wordsOf("- Found it\n- and this")).toBeNull();
  });

  test("a Greek question mark ends a clause, as a full stop does", () => {
    expect(wordsOf("Θέλεις να το κοιτάξω;")).toEqual({ say: "Θέλεις να το κοιτάξω;", rest: "" });
  });

  test("a line break ends one too: the reply is drawn as it is said", () => {
    expect(wordsOf("Found the note you meant\nand this")).toEqual({ say: "Found the note you meant\n", rest: "and this" });
  });
});

describe("turnsOf", () => {
  const harness = () => {
    const log: string[] = [];
    const turns = turnsOf({
      start: (t, sure) => log.push(`start:${t}${sure ? "" : "?"}`),
      confirm: () => log.push("confirm"),
      cancel: () => log.push("cancel"),
    });
    return { log, turns };
  };

  test("an eager turn and its committed text are one request: committed only confirms", () => {
    const { log, turns } = harness();
    turns.eager("what is on my list today");
    turns.turn("what is on my list today");
    expect(log).toEqual(["start:what is on my list today?", "confirm"]);
  });

  test("a committed turn with no eager before it starts one, confirmed", () => {
    const { log, turns } = harness();
    turns.turn("hello");
    expect(log).toEqual(["start:hello"]);
  });

  test("committed words that differ from the eager text are a new turn", () => {
    const { log, turns } = harness();
    turns.eager("add milk");
    turns.turn("add milk and eggs");
    expect(log).toEqual(["start:add milk?", "start:add milk and eggs"]);
  });

  test("the owner going on cancels the guess, and the next eager turn is a new one", () => {
    const { log, turns } = harness();
    turns.eager("add milk");
    turns.resumed();
    turns.eager("add milk and eggs");
    turns.turn("add milk and eggs");
    expect(log).toEqual(["start:add milk?", "cancel", "start:add milk and eggs?", "confirm"]);
  });

  test("the same words said again after new speech are a second request", () => {
    const { log, turns } = harness();
    turns.eager("yes"); turns.turn("yes");
    turns.speech();
    turns.eager("yes"); turns.turn("yes");
    expect(log).toEqual(["start:yes?", "confirm", "start:yes?", "confirm"]);
  });

  test("an empty eager text starts nothing", () => {
    const { log, turns } = harness();
    turns.eager("  ");
    expect(log).toEqual([]);
  });
});
