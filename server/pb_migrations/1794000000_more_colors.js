/// <reference path="../pb_data/types.d.ts" />
// Three more note and tag colours: red, orange, teal (packages/core/src/notes.ts COLORS).
const MORE = ["yellow", "orange", "red", "pink", "purple", "blue", "teal", "green", "gray"];
const OLD = ["yellow", "pink", "blue", "green", "purple", "gray"];
const set = (app, values) => {
  for (const name of ["notes", "tags"]) {
    const c = app.findCollectionByNameOrId(name);
    c.fields.getByName("color").values = values;
    app.save(c);
  }
};
migrate((app) => set(app, MORE), (app) => set(app, OLD));
