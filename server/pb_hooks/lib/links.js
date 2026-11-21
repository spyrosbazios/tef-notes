// What a `links` record must be (pb_migrations/1793300001_links.js; links.pb.js checks it on every save), apart from
// PocketBase so `cd server && bun test` can check it: exactly one `from` and one `to` column set, never the same record at
// both ends. The columns, the roles and a link's own problems are the clients' (core record-links.ts, through
// lib/core.js); what is the server's alone is reading a record's columns and the refusal of a record that names no single
// end on a side. The collection still has `fromShot` and `toShot`, from the screenshot captures that are gone: never set.

const { LINK_TYPES, linkColumn, linkProblem } = require("./core.js");

const SIDES = ["from", "to"];
const GONE = ["fromShot", "toShot"];

/** The ends a record's columns name (`get(column)` reads one): `{from: [{type, id}], to: [...]}`, every column that is set. */
function ends(get) {
  const out = {};
  for (const side of SIDES) out[side] = LINK_TYPES.filter((t) => get(linkColumn(side, t))).map((type) => ({ type, id: get(linkColumn(side, type)) }));
  return out;
}

/** Why a link with these columns (`get(column)`) can't be saved, or null. */
function refusal(get) {
  if (GONE.some((c) => get(c))) return "A link joins notes and tasks only.";
  const e = ends(get);
  for (const side of SIDES) {
    if (e[side].length !== 1) return `A link has one \`${side}\`: exactly one of ${LINK_TYPES.map((t) => linkColumn(side, t)).join(", ")}.`;
  }
  return linkProblem({ from: e.from[0], to: e.to[0], role: get("role") });
}

module.exports = { refusal };
