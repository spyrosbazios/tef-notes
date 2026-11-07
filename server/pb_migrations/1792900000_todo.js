/// <reference path="../pb_data/types.d.ts" />
// Tasks and projects as records of their own (the root AGENTS.md, "Tasks and projects"), no longer lines in notes:
//   projects  a Things project: title, its notes (markdown), an area (a tag name), its headings in order, its place in
//             the list, the day it was done.
//   tasks     a Things to-do: its checklist ([{id, text, done}]), the days and flags of the old brace format, the project
//             and heading it sits under, and the note it is about. A project's delete takes its tasks; a note's delete
//             only unlinks them (pb_hooks/notes.pb.js bumps their rev, so every client hears of it).
// Both carry `rev`, the compare-and-swap of pb_hooks/rev.pb.js, and open rules like notes (1792400000_open.js): the
// tailnet is the gate. Clients name a new record themselves (a PocketBase-style id), so a task can point at a project
// made offline. Empty text means unset, as PocketBase stores it.
migrate((app) => {
  const open = { listRule: "", viewRule: "", createRule: "", updateRule: "", deleteRule: "" };
  const DAY = "^(\\d{4}-\\d{2}-\\d{2})?$";
  const t = (name, o = {}) => ({ name, type: "text", ...o });
  const common = [
    { name: "order", type: "number" },
    t("done", { pattern: DAY }),
    { name: "rev", type: "number", onlyInt: true, min: 1 },
    { name: "created", type: "autodate", onCreate: true },
    { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
  ];

  app.save(new Collection({
    name: "projects", type: "base", ...open,
    fields: [
      t("title", { required: true, max: 500 }), t("notes", { max: 100000 }), t("area", { max: 200 }),
      { name: "headings", type: "json", maxSize: 20000 },
      ...common,
    ],
    indexes: ["CREATE INDEX idx_projects_done ON projects (done)"],
  }));

  const projects = app.findCollectionByNameOrId("projects"), notes = app.findCollectionByNameOrId("notes");
  app.save(new Collection({
    name: "tasks", type: "base", ...open,
    fields: [
      t("title", { required: true, max: 2000 }), t("notes", { max: 100000 }),
      { name: "checklist", type: "json", maxSize: 100000 },
      t("when", { pattern: DAY }), { name: "evening", type: "bool" }, { name: "someday", type: "bool" }, t("due", { pattern: DAY }),
      t("every", { pattern: "^(\\+?[1-9]\\d{0,2}[dwmy]|(mon|tue|wed|thu|fri|sat|sun)(,(mon|tue|wed|thu|fri|sat|sun))*)?$" }),
      t("remind", { pattern: "^(([01]\\d|2[0-3]):[0-5]\\d)?$" }),
      { name: "project", type: "relation", collectionId: projects.id, maxSelect: 1, cascadeDelete: true },
      t("heading", { max: 500 }),
      { name: "note", type: "relation", collectionId: notes.id, maxSelect: 1, cascadeDelete: false },
      ...common,
    ],
    indexes: [
      "CREATE INDEX idx_tasks_done ON tasks (done)",
      "CREATE INDEX idx_tasks_when ON tasks (`when`)",
      "CREATE INDEX idx_tasks_project ON tasks (project)",
    ],
  }));
}, (app) => {
  for (const n of ["tasks", "projects"]) app.delete(app.findCollectionByNameOrId(n));
});
