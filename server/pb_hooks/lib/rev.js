// The compare-and-swap every edited collection holds to (rev.pb.js), what a blob sha was under git: a write names the
// `rev` it was based on and is refused when the record has moved on since, so a phone or the laptop never writes over
// an edit it hasn't seen. A pure function, so `cd server && bun test` can check it; the hook throws what it returns.

/** What each collection's record is called in a refusal. */
const NOUN = { notes: "note", tasks: "task" };

/** The collections under the rev contract. */
const COLLECTIONS = Object.keys(NOUN);

/** Why an update or a delete (`what`) of a `collection` record at rev `was`, based on `base` (the body's or the query's
 *  `rev`, as sent), is refused: [status, message], or null to go ahead. */
function refusal(collection, what, base, was) {
  if (base == null || base === "") return [400, `rev is required: the version this ${what} was based on.`];
  if (Number(base) !== was) return [409, `This ${NOUN[collection] ?? "record"} changed since that version.`];
  return null;
}

module.exports = { COLLECTIONS, refusal };
