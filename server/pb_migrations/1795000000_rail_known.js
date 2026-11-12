/// <reference path="../pb_data/types.d.ts" />
// The desktop's sidebar remembers which screens its record has seen (packages/core/src/prefs.ts `desktop.known`), so a screen
// added later starts hidden without touching the ones the owner already placed. A record saved before that knows the five
// screens there were then: without this it would read as knowing none, and Notes would hide again where it was shown. Data only.
const BEFORE = ["inbox", "today", "upcoming", "logbook", "notes"];
const owner = (app) => { try { return app.findFirstRecordByData("prefs", "key", "owner"); } catch (_) { return null; } };
const dataOf = (r) => { try { const v = JSON.parse(r.getString("data") || "null"); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; } catch (_) { return {}; } };
const without = (o, key) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== key));

migrate((app) => {
  const r = owner(app);
  if (!r) return;
  const d = dataOf(r), desktop = d.desktop && typeof d.desktop === "object" ? d.desktop : null;
  if (!desktop || !Array.isArray(desktop.hidden) || Array.isArray(desktop.known)) return;
  r.set("data", { ...d, desktop: { ...desktop, known: BEFORE } });
  app.save(r);
}, (app) => {
  const r = owner(app);
  if (!r) return;
  const d = dataOf(r), desktop = d.desktop && typeof d.desktop === "object" ? d.desktop : null;
  if (!desktop || !("known" in desktop)) return;
  r.set("data", { ...d, desktop: without(desktop, "known") });
  app.save(r);
});
