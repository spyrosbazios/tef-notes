import { describe, expect, test } from "bun:test";
import { sameOrigin, wordsOf } from "../src/talk";

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

describe("sameOrigin", () => {
  const headers = (h: Record<string, string>) => ({ get: (n: string) => h[n.toLowerCase()] ?? null });

  test("a browser on this server's own host, or a client with no Origin at all", () => {
    expect(sameOrigin(headers({ origin: "https://notes.ts.net:8097", host: "notes.ts.net:8097" }))).toBe(true);
    expect(sameOrigin(headers({ origin: "https://notes.ts.net", "x-forwarded-host": "notes.ts.net" }))).toBe(true);
    expect(sameOrigin(headers({}))).toBe(true);
  });

  test("another website is refused: this is what keeps one out of the socket", () => {
    expect(sameOrigin(headers({ origin: "https://evil.example", host: "notes.ts.net:8097" }))).toBe(false);
    expect(sameOrigin(headers({ origin: "not a url", host: "notes.ts.net" }))).toBe(false);
  });
});
