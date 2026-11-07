import { afterEach, describe, expect, test } from "bun:test";
import { read } from "../pb_hooks/lib/keys.js";

const saved = process.env.TEF_NOTES_KEYS_DIR;
afterEach(() => { if (saved === undefined) delete process.env.TEF_NOTES_KEYS_DIR; else process.env.TEF_NOTES_KEYS_DIR = saved; });

describe("keys.read", () => {
  test("reads <dir>/<name>/api-key, /run by default, trimmed", () => {
    delete process.env.TEF_NOTES_KEYS_DIR;
    const paths = [];
    expect(read("llm", (p) => { paths.push(p); return "  sk-123\n"; })).toBe("sk-123");
    expect(paths).toEqual(["/run/llm/api-key"]);
  });

  test("TEF_NOTES_KEYS_DIR moves the directory", () => {
    process.env.TEF_NOTES_KEYS_DIR = "/keys";
    const paths = [];
    read("typesafe", (p) => { paths.push(p); return "k"; });
    expect(paths).toEqual(["/keys/typesafe/api-key"]);
  });

  test("a missing file or an empty one is the empty string", () => {
    expect(read("exa", () => { throw new Error("no such file"); })).toBe("");
    expect(read("exa", () => " \n")).toBe("");
  });
});
