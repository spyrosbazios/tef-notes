// Not the note format (that is lib/core.js, the clients' own code bundled): only what two applied migrations load.
// pb_migrations/1792700000_tasks.js and 1792800000_note_tasks.js `require` this file and call its `taskIndex` for every
// note there is. On every database they ran against it is done; on a new one there are no notes yet, so they load it
// and call nothing. Applied migrations are never edited, so the file stays while they do; nothing else requires it.

module.exports = {};
