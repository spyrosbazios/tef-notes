/// <reference path="../pb_data/types.d.ts" />
// What a note holds to beyond the rev compare-and-swap (rev.pb.js): its path and its kind never change, and its photos go
// with it. Its links (`links`, pb_migrations/1793300001_links.js) go with it too, by PocketBase's own cascade: neither end
// of a link moves its `rev`, so nothing else is written when a note goes.

// A note made without a kind is a `note`: no client sends one. (`capture`, the screenshot captures' kind, is made no more;
// old ones read as notes.) On every create, a client's or the server's own (clip.pb.js), before the record is
// validated (the column is required).
onRecordCreate((e) => {
  if (!e.record.getString("kind")) e.record.set("kind", "note");
  e.next();
}, "notes");

onRecordUpdateRequest((e) => {
  const was = e.record.original();
  if (e.record.getString("path") !== was.getString("path")) throw new BadRequestError("A note's path never changes.");
  if (e.record.getString("kind") !== was.getString("kind")) throw new BadRequestError("A note's kind never changes.");
  e.next();
}, "notes");

// A note's photos go with it: they live under its id, and nothing else points at them.
onRecordAfterDeleteSuccess((e) => {
  const id = e.record.getString("path").replace(/^.*\//, "").replace(/\.md$/, "");
  for (const a of e.app.findRecordsByFilter("attachments", "note = {:id}", "", 0, 0, { id })) e.app.delete(a);
  e.next();
}, "notes");
