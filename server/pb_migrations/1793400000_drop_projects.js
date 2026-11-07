/// <reference path="../pb_data/types.d.ts" />
// Projects are gone: a task stands on its own. A task that sat in a project keeps it as words, the first line of its notes
// ("Project: <title> (<area>) · <heading>"), and its rev moves so every client re-reads it. Then the tasks' `project`
// and `heading` go, and the `projects` collection with them (its relation no longer holds a task, so no cascade fires).
// One-way: the down step brings the empty fields and collection back, not the projects.
migrate((app) => {
  app.db().newQuery(`
    UPDATE tasks SET
      notes = 'Project: ' || p.title
        || CASE WHEN IFNULL(p.area, '') = '' THEN '' ELSE ' (' || p.area || ')' END
        || CASE WHEN IFNULL(tasks.heading, '') = '' THEN '' ELSE ' · ' || tasks.heading END
        || CASE WHEN IFNULL(tasks.notes, '') = '' THEN '' ELSE char(10) || char(10) || tasks.notes END,
      rev = tasks.rev + 1
    FROM projects p WHERE p.id = tasks.project`).execute();

  const tasks = app.findCollectionByNameOrId("tasks");
  tasks.removeIndex("idx_tasks_project");
  tasks.fields.removeByName("project");
  tasks.fields.removeByName("heading");
  app.save(tasks);
  app.delete(app.findCollectionByNameOrId("projects"));
}, (app) => {
  const open = { listRule: "", viewRule: "", createRule: "", updateRule: "", deleteRule: "" };
  const t = (name, o = {}) => ({ name, type: "text", ...o });
  app.save(new Collection({
    name: "projects", type: "base", ...open,
    fields: [
      t("title", { required: true, max: 500 }), t("notes", { max: 100000 }), t("area", { max: 200 }),
      { name: "headings", type: "json", maxSize: 20000 },
      { name: "order", type: "number" }, t("done", { pattern: "^(\\d{4}-\\d{2}-\\d{2})?$" }),
      { name: "rev", type: "number", onlyInt: true, min: 1 }, { name: "tainted", type: "bool" },
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE INDEX idx_projects_done ON projects (done)"],
  }));
  const tasks = app.findCollectionByNameOrId("tasks");
  tasks.fields.add(new RelationField({ name: "project", collectionId: app.findCollectionByNameOrId("projects").id, maxSelect: 1, cascadeDelete: true }));
  tasks.fields.add(new TextField({ name: "heading", max: 500 }));
  tasks.addIndex("idx_tasks_project", false, "project", "");
  app.save(tasks);
});
