/// <reference path="../pb_data/types.d.ts" />
// The owner's preferences (packages/core/src/prefs.ts) get one group per layout: `phone` (below `md`: where the app opens,
// Home's list, the bottom bar's tabs, their labels, the list the Tasks tab opens on) and `desktop` (where the app opens, Home's
// list, Notes in the rail). What was one setting for both, the start screen and Home's list, starts the same in each; the
// rail listed Notes when the phone's bar showed it, so `desktop.notesPage` starts as that. Data only: the collection is as it was.
const PHONE = ["start", "homeList", "tabs", "hidden", "tabLabels", "tasksList"];
const BOTH = ["start", "homeList"];

const owner = (app) => { try { return app.findFirstRecordByData("prefs", "key", "owner"); } catch (_) { return null; } };
const dataOf = (r) => { try { const v = JSON.parse(r.getString("data") || "null"); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; } catch (_) { return {}; } };
const pick = (from, keys) => Object.fromEntries(keys.filter((k) => from[k] !== undefined).map((k) => [k, from[k]]));

migrate((app) => {
  const r = owner(app);
  if (!r) return;
  const d = dataOf(r);
  if (d.phone || d.desktop) return;
  const tabs = Array.isArray(d.tabs) ? d.tabs : [], hidden = Array.isArray(d.hidden) ? d.hidden : [];
  const next = Object.fromEntries(Object.entries(d).filter(([k]) => !PHONE.includes(k)));
  next.phone = pick(d, PHONE);
  next.desktop = { ...pick(d, BOTH), notesPage: tabs.includes("notes") && !hidden.includes("notes") };
  r.set("data", next);
  app.save(r);
}, (app) => {
  const r = owner(app);
  if (!r) return;
  const d = dataOf(r), phone = d.phone && typeof d.phone === "object" ? d.phone : {};
  const rest = Object.fromEntries(Object.entries(d).filter(([k]) => k !== "phone" && k !== "desktop"));
  r.set("data", { ...rest, ...pick(phone, PHONE) });
  app.save(r);
});
