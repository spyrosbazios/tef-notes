// The lens as a browser setting. (What it does to a new note and a new task is in todo.test.ts, which holds the fake server.)
import { beforeEach, describe, expect, test } from "bun:test";
import "./storage";
import { QueryClient } from "@tanstack/react-query";
import { activeLensOf, LENSES, setActiveLens } from "@/hooks/lens";

let qc: QueryClient;
beforeEach(() => { qc = new QueryClient(); setActiveLens(null); });
const work = { rec: "w", name: "Work", tags: ["work", "clients"], exclude: [], accent: null };

describe("the active lens", () => {
  test("is none until one is chosen, and none again when the chosen one is gone", () => {
    qc.setQueryData(LENSES, [work]);
    expect(activeLensOf(qc)).toBeNull();
    setActiveLens("w");
    expect(activeLensOf(qc)).toEqual(work);
    qc.setQueryData(LENSES, []);
    expect(activeLensOf(qc)).toBeNull();
  });
});
