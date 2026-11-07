// The auto-tagger's logic, apart from PocketBase (pb_hooks/autotag.pb.js owns the cron, the database and the HTTP
// call), so it can be tested under bun (test/autotag.test.js). `require`d by the hook: a handler runs in a VM of its
// own and sees none of the hook file's top-level scope.
//
// Tags are decided by JEV (TypeSafe's decision model) through its System One API, https://docs.typesafe.ai: one noul
// (yes/no, answered as a probability) question per tag definition, about a note or a task alike (`kind`). At or above
// AUTO (likelier than not) the server adds the tag to the record itself; there are no suggestions to accept.

const { URL, MODEL } = require("./jev.js");
const PER_CALL = 20;                    // questions in one request
const MAX_CHARS = 12000;                // of note text; only input tokens are billed
const BATCH = 50;                       // notes, and as many tasks, evaluated per run
const PHOTOS = 3;                       // of a note's photos JEV is shown (the first embedded); input tokens, once per request
const AUTO = 0.5;                       // at or above: added to the note or task

// ---- tag names

const { fold } = require("./notes.js");

/** The names in `list` that `names` does not have, ignoring case and tonos, each once. */
function without(list, names) {
  const seen = names.map(fold), out = [];
  for (const n of list) {
    const k = fold(n);
    if (seen.includes(k)) continue;
    seen.push(k);
    out.push(n);
  }
  return out;
}

/** What the tag definitions say, as one short string: when it changes, every note and task is worth asking about again. 32-bit
 *  FNV-1a over name and description, in name order. */
function defsHash(defs) {
  const s = defs.map((d) => `${d.name}\u0000${d.description}`).sort().join("\u0001");
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}

/** `tagged`: the state a note or task was last evaluated in. */
const taggedKey = (rev, hash) => `${rev}:${hash}`;

// ---- asking JEV

/** The System One question for one definition about a `kind` ("note" or "task"); `photos` says the note's pictures
 *  (`state.photos`) are part of it. */
const ask = (d, photos, kind) => ({
  type: "noul",
  instructions: `Should this ${kind} carry the tag "${d.name}"?${d.description.trim() ? ` The tag means: ${d.description.trim()}` : ""}${photos ? ` The ${kind}'s photos are part of it.` : ""}`,
  criteria: { true: `The ${kind} belongs under "${d.name}".`, false: `The ${kind} does not belong under "${d.name}".` },
});

/** What JEV is asked about a task being typed: its title and, as the text, its notes. A task has no photos. */
const taskItem = ({ title, notes = "" }) => ({ kind: "task", title, body: notes.trim() });

/** The request bodies (20 questions at most each) for `defs` about a note, or a task (`note.kind`, see taskItem; a note
 *  is `{title, body}`), each with the definitions its question ids
 *  `t0`, `t1`, ... stand for. `photos` are the pictures JEV is shown, `{ref, format, data, caption}` (`data` base64, `ref`
 *  a fresh random string TypeSafe swaps for the image): they go in `state.photos` and the request's `assets`, in every
 *  request, each of which is billed for them. With none, the body is the text's alone. */
function requests(note, defs, photos = []) {
  const kind = note.kind || "note", state = { title: note.title, text: note.body.slice(0, MAX_CHARS) }, out = [];
  if (photos.length) state.photos = photos.map((p) => (p.caption ? { picture: p.ref, caption: p.caption } : { picture: p.ref }));
  const assets = Object.fromEntries(photos.map((p) => [p.ref, { type: "image", format: p.format, data_base64: p.data }]));
  for (let i = 0; i < defs.length; i += PER_CALL) {
    const chunk = defs.slice(i, i + PER_CALL), questions = Object.fromEntries(chunk.map((d, j) => [`t${j}`, ask(d, photos.length > 0, kind)]));
    out.push({ defs: chunk, body: photos.length ? { model: MODEL, state, questions, assets } : { model: MODEL, state, questions } });
  }
  return out;
}

/** The probabilities in one response, by definition; a question that came back unanswered is left out. */
const probabilities = (chunk, json) => chunk.flatMap((d, j) => {
  const p = json && json.answers && json.answers[`t${j}`] ? json.answers[`t${j}`].noul : undefined;
  return typeof p === "number" ? [{ name: d.name, p }] : [];
});

/** The tags to add to a note or task, given every question's probability, likeliest first. */
const decide = (ps) => ps.filter((x) => x.p >= AUTO).sort((a, b) => b.p - a.p).map((x) => x.name);

// ---- a task being typed (the guess route, autotag.pb.js)

const GUESS_CHARS = 4000;               // of a draft's title and notes together

/** A guess request's body as `{title, notes}`, both strings, cut to GUESS_CHARS; null for anything else. */
function guessInput(body) {
  if (!body || typeof body.title !== "string" || (body.notes !== undefined && typeof body.notes !== "string")) return null;
  const title = body.title.trim().slice(0, GUESS_CHARS), notes = (body.notes || "").trim().slice(0, GUESS_CHARS - title.length);
  return { title, notes };
}

module.exports = { GUESS_CHARS, guessInput, PER_CALL, MAX_CHARS, BATCH, PHOTOS, AUTO, without, defsHash, taggedKey, taskItem, requests, probabilities, decide };
