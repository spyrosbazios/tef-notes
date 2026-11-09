/// <reference path="../pb_data/types.d.ts" />
// The desktop's sidebar hides any of its screens, not only Notes (packages/core/src/prefs.ts `desktop.hidden`, the screens it
// doesn't list): the preferences' `desktop.notesPage` becomes that list, holding "notes" when it was off. Data only.
const owner = (app) => { try { return app.findFirstRecordByData("prefs", "key", "owner"); } catch (_) { return null; } };
const dataOf = (r) => { try { const v = JSON.parse(r.getString("data") || "null"); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; } catch (_) { return {}; } };
const without = (o, key) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== key));

migrate((app) => {
  const r = owner(app);
  if (!r) return;
  const d = dataOf(r), desktop = d.desktop && typeof d.desktop === "object" ? d.desktop : null;
  if (!desktop || Array.isArray(desktop.hidden)) return;
  r.set("data", { ...d, desktop: { ...without(desktop, "notesPage"), hidden: desktop.notesPage === true ? [] : ["notes"] } });
  app.save(r);
}, (app) => {
  const r = owner(app);
  if (!r) return;
  const d = dataOf(r), desktop = d.desktop && typeof d.desktop === "object" ? d.desktop : null;
  if (!desktop) return;
  const hidden = Array.isArray(desktop.hidden) ? desktop.hidden : [];
  r.set("data", { ...d, desktop: { ...without(desktop, "hidden"), notesPage: !hidden.includes("notes") } });
  app.save(r);
});
