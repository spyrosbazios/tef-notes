/// <reference path="../pb_data/types.d.ts" />
// `tainted` on notes and tasks (pb_migrations/1792600000_chats.js, 1793000002_todo_tainted.js): the record holds text
// the owner didn't write, set by whoever wrote it (the chat agent after reading the web, the CLI under
// TEF_NOTES_AGENT=1, the clip routes through lib/records.js). A chat that reads it back treats it like web text and
// asks before it writes. Rewriting the record doesn't make that text the owner's, so the mark is never taken off: on
// every save, a request's or a hook's, a record that was tainted stays tainted, whatever the write sent.

onRecordUpdate((e) => {
  if (e.record.original().getBool("tainted")) e.record.set("tainted", true);
  e.next();
}, "notes", "tasks");
