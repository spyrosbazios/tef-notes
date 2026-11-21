// The auto-tagger's logic, apart from PocketBase (pb_hooks/autotag.pb.js owns the cron, the database and the HTTP
// call), so it can be tested under bun (test/autotag.test.js). `require`d by the hook: a handler runs in a VM of its
// own and sees none of the hook file's top-level scope.
//
// Tags are decided by JEV (TypeSafe's decision model) through its System One API, https://docs.typesafe.ai: one noul
// (yes/no, answered as a probability) question per tag definition, about a note or a task alike (`kind`). There are no
// suggestions to accept: a tag at or above its cut is added, and a wrong one is removed by hand.
//
// What the owner did teaches it (`profile`): each question names a few notes the owner filed under the tag by hand and a
// few the owner took it off (the tagger's `autotagged` less the note's tags), and a tag taken off often needs a likelier
// answer (`cutOf`). A note carries at most MAX_AUTO of the tagger's tags.

const { URL, MODEL } = require("./jev.js");
const PER_CALL = 20;                    // questions in one request
const MAX_CHARS = 12000;                // of note text; only input tokens are billed
const BATCH = 50;                       // notes evaluated per run
const PHOTOS = 3;                       // of a note's photos JEV is shown (the first embedded); input tokens, once per request
const AUTO = 0.7;                       // a tag's cut before anything was taken off: at or above it, the tag is added
const STRICT = 0.3;                     // how far a tag's removal rate raises its cut
const CEIL = 0.92;                      // the highest cut
const MAX_AUTO = 3;                     // of the tagger's tags a note carries at most (those taken off don't count)
const EXAMPLES = 3;                     // titles of each kind (filed, taken off) in a tag's question
const TITLE_CHARS = 80;                 // of an example's title

// ---- tag names

const { fold } = require("./notes.js");
const { spread, noteTags } = require("./rows.js");

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

/** 32-bit FNV-1a of `s`, as 8 hex digits. */
function fnv(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}

/** What the tag definitions say, as one short string: when it changes, every note is worth asking about again. The
 *  names, and the descriptions the owner wrote (`own`), in name order. A description the server wrote itself
 *  (lib/tags.js) is left out: it is drawn from the tagged notes, and asking them all again with it is how a tag spread
 *  over notes it never fitted. */
const defsHash = (defs) => fnv(defs.map((d) => `${d.name}\u0000${d.own ? d.description : ""}`).sort().join("\u0001"));

/** What JEV reads of a note or task (its title and text), as one short string: a `rev` bump that changes neither (a tag
 *  taken off, a pin) is no reason to ask again. */
const contentKey = (item) => fnv(`${item.title}\u0000${item.body}`);

/** `tagged`: the state a note was last evaluated in, `"<rev>:<defsHash>:<contentKey>"`. */
const taggedKey = (rev, hash, content) => `${rev}:${hash}:${content}`;

/** Whether a note whose `tagged` is this needs no question: it was asked about with these definitions and this text.
 *  `"<rev>:<hash>"`, the key before the text was part of it, counts as asked at that `rev`, so a deploy asks nothing. */
function fresh(tagged, rev, hash, content) {
  const p = String(tagged || "").split(":");
  if (p.length === 2) return p[0] === String(rev);
  return p.length === 3 && p[1] === hash && p[2] === content;
}

// ---- what the owner taught it

/** Each tag's record, by folded name, from every note's `{ id, title, tags, auto, updated }` (`auto`: the tagger's
 *  `autotagged`): `yes` the notes carrying it the owner tagged by hand, `no` the ones the owner took it off, both newest
 *  first as `{ id, title }`; `added` how many notes the tagger gave it, `removed` how many of those lost it. */
function profile(rows) {
  const out = new Map();
  const of = (k) => { let p = out.get(k); if (!p) out.set(k, p = { yes: [], no: [], added: 0, removed: 0 }); return p; };
  for (const r of rows.slice().sort((a, b) => (a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : 0))) {
    const tags = r.tags.map(fold), auto = r.auto.map(fold), note = { id: r.id, title: r.title };
    for (const k of new Set(tags)) if (!auto.includes(k)) of(k).yes.push(note);
    for (const k of new Set(auto)) {
      const p = of(k);
      p.added++;
      if (!tags.includes(k)) { p.removed++; p.no.push(note); }
    }
  }
  return out;
}

/** The probability a tag needs: AUTO, raised by how often the owner took it off what the tagger gave it (counted as if
 *  three more had been kept, so one removal doesn't silence a tag), never above CEIL. */
const cutOf = (p) => Math.min(CEIL, AUTO + STRICT * (p ? p.removed / (p.added + 3) : 0));

/** The definitions as the tagger asks them: `{ name, description, own, yes, no, cut }`, from the `tags` collection's
 *  `{ name, description, describedBy }` and `profile`'s map. */
const definitions = (tags, profiles) => tags.map((t) => ({ name: t.name.trim(), description: t.description || "", own: t.describedBy === "owner" }))
  .filter((d) => d.name)
  .map((d) => {
    const p = profiles.get(fold(d.name));
    return { ...d, yes: p ? p.yes : [], no: p ? p.no : [], cut: cutOf(p) };
  });

/** The definitions from the database (hooks only): the tag records and every note's tags. */
function load(app) {
  const profiles = profile(noteTags(app).map((r) => ({ id: r.id, title: r.title, tags: r.tags, auto: r.autotagged, updated: r.updated })));
  return definitions(app.findAllRecords("tags").map((r) => ({ name: r.getString("name"), description: r.getString("description"), describedBy: r.getString("describedBy") })), profiles);
}

// ---- asking JEV

const titled = (n) => `"${String(n.title || "").replace(/"/g, "'").replace(/\s+/g, " ").trim().slice(0, TITLE_CHARS)}"`;

/** The System One question for one definition about a `kind` ("note", "task", "page"); `photos` says the note's
 *  pictures (`state.photos`) are part of it; `self` is the note being asked about, never its own example. */
function ask(d, photos, kind, self) {
  const yes = spread((d.yes || []).filter((n) => n.id !== self), EXAMPLES), no = spread((d.no || []).filter((n) => n.id !== self), EXAMPLES);
  const parts = [`Should this ${kind} carry the tag "${d.name}"?`];
  if (d.description.trim()) parts.push(`The tag means: ${d.description.trim()}`);
  if (yes.length) parts.push(`Notes the owner filed under it: ${yes.map(titled).join("; ")}.`);
  if (no.length) parts.push(`Notes the owner took it off, as not fitting: ${no.map(titled).join("; ")}.`);
  if (yes.length || no.length) parts.push(`Say yes only if this ${kind} is about the same thing as the notes filed under it.`);
  if (photos) parts.push(`The ${kind}'s photos are part of it.`);
  return {
    type: "noul",
    instructions: parts.join(" "),
    criteria: { true: `The ${kind} belongs under "${d.name}".`, false: `The ${kind} does not belong under "${d.name}".` },
  };
}

/** What JEV is asked about a task being typed: its title and, as the text, its notes. A task has no photos. */
const taskItem = ({ title, notes = "" }) => ({ kind: "task", title, body: notes.trim() });

/** The request bodies (20 questions at most each) for `defs` about a note, or a task (`note.kind`, see taskItem; a note
 *  is `{title, body}`), each with the definitions its question ids `t0`, `t1`, ... stand for. `photos` are the pictures
 *  JEV is shown, `{ref, format, data, caption}` (`data` base64, `ref` a fresh random string TypeSafe swaps for the
 *  image): they go in `state.photos` and the request's `assets`, in every request, each of which is billed for them.
 *  With none, the body is the text's alone. `self`: the note's id, left out of the examples. */
function requests(note, defs, photos = [], self = "") {
  const kind = note.kind || "note", state = { title: note.title, text: note.body.slice(0, MAX_CHARS) }, out = [];
  if (photos.length) state.photos = photos.map((p) => (p.caption ? { picture: p.ref, caption: p.caption } : { picture: p.ref }));
  const assets = Object.fromEntries(photos.map((p) => [p.ref, { type: "image", format: p.format, data_base64: p.data }]));
  for (let i = 0; i < defs.length; i += PER_CALL) {
    const chunk = defs.slice(i, i + PER_CALL), questions = Object.fromEntries(chunk.map((d, j) => [`t${j}`, ask(d, photos.length > 0, kind, self)]));
    out.push({ defs: chunk, body: photos.length ? { model: MODEL, state, questions, assets } : { model: MODEL, state, questions } });
  }
  return out;
}

/** The probabilities in one response, by definition; a question that came back unanswered is left out. */
const probabilities = (chunk, json) => chunk.flatMap((d, j) => {
  const p = json && json.answers && json.answers[`t${j}`] ? json.answers[`t${j}`].noul : undefined;
  return typeof p === "number" ? [{ name: d.name, p }] : [];
});

/** The tags to add, likeliest first: each at or above its definition's cut (AUTO for a name `defs` doesn't have), at
 *  most `room`. */
function decide(ps, defs = [], room = MAX_AUTO) {
  const cut = (name) => { const d = defs.find((x) => fold(x.name) === fold(name)); return d ? d.cut : AUTO; };
  return ps.filter((x) => x.p >= cut(x.name)).sort((a, b) => b.p - a.p).slice(0, Math.max(0, room)).map((x) => x.name);
}

// ---- a task being typed (the guess route, autotag.pb.js)

const GUESS_CHARS = 4000;               // of a draft's title and notes together

/** A guess request's body as `{title, notes}`, both strings, cut to GUESS_CHARS; null for anything else. */
function guessInput(body) {
  if (!body || typeof body.title !== "string" || (body.notes !== undefined && typeof body.notes !== "string")) return null;
  const title = body.title.trim().slice(0, GUESS_CHARS), notes = (body.notes || "").trim().slice(0, GUESS_CHARS - title.length);
  return { title, notes };
}

module.exports = {
  GUESS_CHARS, guessInput, PER_CALL, MAX_CHARS, BATCH, PHOTOS, AUTO, STRICT, CEIL, MAX_AUTO, EXAMPLES,
  without, defsHash, contentKey, taggedKey, fresh, profile, cutOf, definitions, load, taskItem, requests, probabilities, decide,
};
