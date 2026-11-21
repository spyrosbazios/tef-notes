/// <reference path="../pb_data/types.d.ts" />
// Compare-and-swap on `rev` for notes, tasks, the preferences record and chats (lib/rev.js): a create starts at rev 1; an update
// sends the rev it read and gets rev + 1; a delete passes `?rev=` (not a chat's: lib/rev.js DELETES). A stale one is a 409, a
// missing one a 400. A handler runs in its own VM and sees none of this file's top level: the lib is required inside each (and
// once here, for the lists).

const { COLLECTIONS, DELETES } = require(`${__hooks}/lib/rev.js`);

onRecordCreateRequest((e) => {
  e.record.set("rev", 1);
  e.next();
}, ...COLLECTIONS);

onRecordUpdateRequest((e) => {
  const { refusal } = require(`${__hooks}/lib/rev.js`);
  const was = e.record.original().getInt("rev"), no = refusal(e.collection.name, "edit", e.requestInfo().body["rev"], was);
  if (no) throw new ApiError(no[0], no[1]);
  e.record.set("rev", was + 1);
  e.next();
}, ...COLLECTIONS);

onRecordDeleteRequest((e) => {
  const { refusal } = require(`${__hooks}/lib/rev.js`);
  const no = refusal(e.collection.name, "delete", e.requestInfo().query["rev"], e.record.getInt("rev"));
  if (no) throw new ApiError(no[0], no[1]);
  e.next();
}, ...DELETES);
