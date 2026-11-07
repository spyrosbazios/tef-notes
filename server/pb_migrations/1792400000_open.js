/// <reference path="../pb_data/types.d.ts" />
// No sign-in: the private network is the gate. PocketBase listens on loopback only and the owner's devices reach it
// through a reverse proxy on that network (e.g. Tailscale serve), so a token added a login on every device and kept out nobody the network doesn't already.
// Photos go public with the rules: a protected file needs a file token, which needs a signed-in user.
// The superuser account (the /_/ dashboard) is untouched; the owner's `users` record stays, unused.
const RULES = ["listRule", "viewRule", "createRule", "updateRule", "deleteRule"];

/** Every rule of `name` but `skip` set to `rule`, and its file field protected or not. */
function set(app, name, rule, skip = []) {
  const c = app.findCollectionByNameOrId(name);
  for (const k of RULES) if (!skip.includes(k)) c[k] = rule;
  const file = c.fields.getByName("file");
  if (file) file.protected = rule !== "";
  app.save(c);
}

migrate((app) => {
  set(app, "notes", "");
  set(app, "attachments", "", ["updateRule"]);      // stays null: a photo never changes
}, (app) => {
  const AUTH = "@request.auth.id != ''";
  set(app, "notes", AUTH);
  set(app, "attachments", AUTH, ["updateRule"]);
});
