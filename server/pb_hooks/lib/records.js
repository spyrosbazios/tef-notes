// The rev contract for the server's own writes. A save from a hook or a cron fires none of the request hooks (rev.pb.js),
// so every hook that writes a note or a task goes through here instead of bumping `rev` by hand: one copy of the
// compare-and-swap, of the columns a note carries beside its text (notes.js columns), and of the `tainted` mark.
//
// `tainted` (pb_migrations/1792600000_chats.js, 1793000002_todo_tainted.js): a record holding text the owner didn't
// write (a clipped page, a share from another app, what a model wrote) is marked, so a chat that reads it back treats
// it like web text and asks before it writes.
//
// Plain CommonJS over the transaction PocketBase hands a hook (`tx`: findRecordById, findCollectionByNameOrId, save),
// so bun can test it with a fake (server/test/records.test.js).

const { columns } = require("./notes.js");

/** A note's text written to its record with every column copied out of it; a task has none. */
function copyColumns(collection, rec) {
  if (collection !== "notes") return;
  const cols = columns(rec.getString("path"), rec.getString("text"));
  for (const k of Object.keys(cols)) rec.set(k, cols[k]);
}

/**
 * Re-read the `collection` record `id` inside `tx`, let `mutate(rec)` change it, copy a note's columns from its text,
 * bump `rev`, mark it `tainted` when `taint`, and save it. `expectRev`: the rev the change was based on, when it was
 * worked out from an earlier read (the write is dropped if the record moved since). `mutate` returning false drops the
 * write too. Returns the saved record, or null when nothing was written (gone, moved, or dropped).
 */
function casWrite(tx, collection, id, mutate, opts = {}) {
  let rec;
  try { rec = tx.findRecordById(collection, id); } catch (_) { return null; }
  const rev = rec.getInt("rev");
  if (opts.expectRev != null && rev !== opts.expectRev) return null;
  if (mutate(rec) === false) return null;
  copyColumns(collection, rec);
  rec.set("rev", rev + 1);
  if (opts.taint) rec.set("tainted", true);
  tx.save(rec);
  return rec;
}

/** A new `collection` record, filled by `fill(rec)`, a note's columns copied from its text, at rev 1, `tainted` when
 *  `taint`, saved in `tx`. Returns it. */
function create(tx, collection, fill, opts = {}) {
  const rec = new Record(tx.findCollectionByNameOrId(collection));
  fill(rec);
  copyColumns(collection, rec);
  rec.set("rev", 1);
  if (opts.taint) rec.set("tainted", true);
  tx.save(rec);
  return rec;
}

module.exports = { casWrite, create };
