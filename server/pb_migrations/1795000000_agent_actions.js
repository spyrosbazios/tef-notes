/// <reference path="../pb_data/types.d.ts" />
// The assistant's one "write without asking" switch (`agent.unasked`) becomes a rule per write action (packages/core/src/actions.ts,
// the preferences' `actions`), each set as the switch behaved: on, the writes it covered go ahead ("auto") and deletes and files
// still ask; off, or never set, every write asks, which is the defaults, so nothing is written. Memory went ahead either way. Data only.
const owner = (app) => { try { return app.findFirstRecordByData("prefs", "key", "owner"); } catch (_) { return null; } };
const dataOf = (r) => { try { const v = JSON.parse(r.getString("data") || "null"); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; } catch (_) { return {}; } };
const objOf = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
const without = (o, key) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== key));
const UNASKED = ["createTask", "editTask", "createNote", "editNote", "tags"];

migrate((app) => {
  const r = owner(app);
  if (!r) return;
  const d = dataOf(r), agent = objOf(d.agent);
  if (!("unasked" in agent)) return;
  const actions = agent.unasked === true ? { ...Object.fromEntries(UNASKED.map((a) => [a, "auto"])), ...objOf(d.actions) } : objOf(d.actions);
  r.set("data", { ...d, agent: without(agent, "unasked"), ...(Object.keys(actions).length ? { actions } : {}) });
  app.save(r);
}, (app) => {
  const r = owner(app);
  if (!r) return;
  const d = dataOf(r), actions = objOf(d.actions);
  r.set("data", { ...without(d, "actions"), agent: { ...objOf(d.agent), unasked: UNASKED.every((a) => actions[a] === "auto") } });
  app.save(r);
});
