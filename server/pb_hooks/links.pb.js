/// <reference path="../pb_data/types.d.ts" />
// A `links` record's shape (pb_migrations/1793300001_links.js, lib/links.js): one `from` end, one `to` end, a role, never a
// record linked to itself. On every save, a client's or the server's own (a clip to a new task), so none slips past. The ends
// are relations: PocketBase has already checked each points at a record, and deletes the link with either end.

onRecordValidate((e) => {
  const { refusal } = require(`${__hooks}/lib/links.js`);
  const no = refusal((c) => e.record.getString(c));
  if (no) throw new BadRequestError(no);
  e.next();
}, "links");
