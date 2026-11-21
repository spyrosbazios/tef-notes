/// <reference path="../pb_data/types.d.ts" />
// A monthly or yearly repeat may end in `@29`, `@30` or `@31`: the day of the month it is meant for (`1m@30`), written by a
// tick when a short month clamped the round (packages/core/src/dates.ts `everyOn`), so the next one counts from the 30th and
// not from February's 28th. Only the `every` pattern of `tasks` is relaxed; every value it took before still passes.
const OLD = "^(\\+?[1-9]\\d{0,2}[dwmy]|(mon|tue|wed|thu|fri|sat|sun)(,(mon|tue|wed|thu|fri|sat|sun))*)?$";
const NEW = "^(\\+?[1-9]\\d{0,2}[dwmy]|[1-9]\\d{0,2}[my]@(29|30|31)|(mon|tue|wed|thu|fri|sat|sun)(,(mon|tue|wed|thu|fri|sat|sun))*)?$";
const set = (app, pattern) => {
  const c = app.findCollectionByNameOrId("tasks");
  c.fields.getByName("every").pattern = pattern;
  app.save(c);
};
migrate((app) => set(app, NEW), (app) => set(app, OLD));
