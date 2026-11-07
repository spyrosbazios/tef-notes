// The always-on assistant's phone half (store/assistant.ts): the page context read from the route, and where a UI tool
// asks to go, checked against what the phone holds. The contract's own reader is tested in packages/core.
import { describe, expect, it } from "vitest";
import { contextFor, destination, type Look } from "@/store/assistant";

const look: Look = {
  pathOf: (id) => (id === "20261102-garage" ? "notes/20261102-garage.md" : undefined),
  note: (path) => (path === "notes/20261102-garage.md" ? { title: "Garage door", rev: 3 } : undefined),
  task: (id) => (id === "t1" ? { title: "Oil" } : undefined),
  tags: [],
  list: null,
  lens: null,
};

describe("the page context", () => {
  it("reads the tabs", () => {
    expect(contextFor("/home", look)).toEqual({ client: "phone", view: { kind: "home" } });
    expect(contextFor("/home", { ...look, tags: ["car"] }).view).toEqual({ kind: "tag", tag: "car" });
    expect(contextFor("/today", { ...look, list: "upcoming" }).view).toEqual({ kind: "upcoming" });
    expect(contextFor("/today", { ...look, list: "nowhere" }).view).toEqual({ kind: "today" });
  });

  it("names the open note and task", () => {
    expect(contextFor("/note/20261102-garage", look)).toEqual({ client: "phone", view: { kind: "notes" }, note: { path: "notes/20261102-garage.md", title: "Garage door", rev: 3 } });
    expect(contextFor("/task/t1", look)).toEqual({ client: "phone", view: { kind: "today" }, task: { id: "t1", title: "Oil" } });
    expect(contextFor("/task/t1", { ...look, list: "inbox" }).view).toEqual({ kind: "inbox" });
  });

  it("leaves out what the phone doesn't hold", () => {
    expect(contextFor("/note/unknown", look).note).toBeUndefined();
    expect(contextFor("/task/nope", look)).toEqual({ client: "phone", view: { kind: "today" } });
    expect(contextFor("/nowhere", look).view).toEqual({ kind: "home" });
  });
});

describe("where a UI tool goes", () => {
  it("opens what the phone has", () => {
    expect(destination("open_note", { path: "notes/20261102-garage.md" }, look)).toEqual({ to: "note", path: "notes/20261102-garage.md" });
    expect(destination("open_task", { id: "t1" }, look)).toEqual({ to: "task", id: "t1" });
    expect(destination("go_view", { view: "upcoming" }, look)).toEqual({ to: "list", list: "upcoming" });
    expect(destination("go_view", { view: "tag", tag: "car" }, look)).toEqual({ to: "notes", tags: ["car"] });
  });

  it("says why when it can't", () => {
    expect(destination("open_note", { path: "notes/missing.md" }, look)).toHaveProperty("error");
    expect(destination("open_note", { path: "../etc" }, look)).toHaveProperty("error");
    expect(destination("open_task", { id: "nope" }, look)).toHaveProperty("error");
    expect(destination("go_view", { view: "pinned" }, look)).toEqual({ error: "The phone has no pinned view." });
    expect(destination("go_view", { view: "tag" }, look)).toHaveProperty("error");
  });
});
