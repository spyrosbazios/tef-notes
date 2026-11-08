/// <reference path="../pb_data/types.d.ts" />
// Web Push for task reminders (packages/core/src/push.ts, server/agent/src/push.ts and reminders.ts). The agent, not
// PocketBase, sends them, over the same open rules as everything else: the private network is the gate.
// `push_subscriptions`: one record per browser the owner turned reminders on in. `endpoint` is the browser's push
// service URL, unique, so subscribing again replaces; `keys` its `{p256dh, auth}`; `label` which device; `failed` the
// sends in a row the push service refused (the agent drops the record at 5, and at once on a 404 or 410).
// `push_sent`: a reminder already sent, keyed `<task id>@<when>T<remind>`, unique so two scans never both send it. Kept
// two days (the agent prunes), and a task whose `when` or `remind` changes is a new key: it rings again, as it should.
migrate((app) => {
  app.save(new Collection({
    name: "push_subscriptions", type: "base", listRule: "", viewRule: "", createRule: "", updateRule: "", deleteRule: "",
    fields: [
      { name: "endpoint", type: "text", required: true, min: 1, max: 2048 },
      { name: "keys", type: "json", required: true, maxSize: 2000 },
      { name: "label", type: "text", max: 80 },
      { name: "failed", type: "number", onlyInt: true, min: 0 },
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_push_subscriptions_endpoint ON push_subscriptions (endpoint)"],
  }));
  app.save(new Collection({
    name: "push_sent", type: "base", listRule: "", viewRule: "", createRule: "", updateRule: "", deleteRule: "",
    fields: [
      { name: "key", type: "text", required: true, min: 1, max: 100 },
      { name: "created", type: "autodate", onCreate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_push_sent_key ON push_sent (key)"],
  }));
}, (app) => {
  app.delete(app.findCollectionByNameOrId("push_sent"));
  app.delete(app.findCollectionByNameOrId("push_subscriptions"));
});
