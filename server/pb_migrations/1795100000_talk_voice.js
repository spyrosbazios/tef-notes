/// <reference path="../pb_data/types.d.ts" />
// Voice input is Fish Audio's, so there is no speech model on the server to keep loaded: the preferences' `voice` group (its
// only field, `keep`) goes (packages/core/src/prefs.ts). Data only; a reader that finds it anyway ignores it.
const owner = (app) => { try { return app.findFirstRecordByData("prefs", "key", "owner"); } catch (_) { return null; } };
const dataOf = (r) => { try { const v = JSON.parse(r.getString("data") || "null"); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; } catch (_) { return {}; } };
const without = (o, key) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== key));

migrate((app) => {
  const r = owner(app);
  if (!r) return;
  const d = dataOf(r);
  if (!("voice" in d)) return;
  r.set("data", without(d, "voice"));
  app.save(r);
}, (app) => {
  // Back: the setting it had, as the old default (five minutes) — the value it held is not known from here
  const r = owner(app);
  if (!r) return;
  const d = dataOf(r);
  if ("voice" in d) return;
  r.set("data", { ...d, voice: { keep: 300 } });
  app.save(r);
});
