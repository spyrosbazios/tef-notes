// What a `links` record must be (pb_migrations/1793300001_links.js; links.pb.js checks it on every save), apart from
// PocketBase so `cd server && bun test` can check it: exactly one `from` and one `to` column set, never the same record at
// both ends. The clients' half is packages/core/src/record-links.ts (test/links.test.js compares the two: change them
// together). The collection still has `fromShot` and `toShot`, from the screenshot captures that are gone: never set.

const SIDES = ["from", "to"];
const TYPES = ["note", "task"];
const GONE = ["fromShot", "toShot"];
const ROLES = ["about", "source"];

/** The column of one end: `fromNote`, `toTask`. */
const column = (side, type) => `${side}${type[0].toUpperCase()}${type.slice(1)}`;

/** Every end column, in the unique index's order. */
const COLUMNS = SIDES.flatMap((side) => TYPES.map((type) => column(side, type)));

/** The ends a record's columns name (`get(column)` reads one): `{from: [{type, id}], to: [...]}`, every column that is set. */
function ends(get) {
  const out = {};
  for (const side of SIDES) out[side] = TYPES.filter((t) => get(column(side, t))).map((type) => ({ type, id: get(column(side, type)) }));
  return out;
}

/** Why a link with these columns (`get(column)`) can't be saved, or null. */
function refusal(get) {
  if (GONE.some((c) => get(c))) return "A link joins notes and tasks only.";
  const e = ends(get);
  for (const side of SIDES) {
    if (e[side].length !== 1) return `A link has one \`${side}\`: exactly one of ${TYPES.map((t) => column(side, t)).join(", ")}.`;
  }
  if (!ROLES.includes(get("role"))) return `A link's role is one of ${ROLES.join(", ")}.`;
  if (e.from[0].type === e.to[0].type && e.from[0].id === e.to[0].id) return "A link joins two records, not one to itself.";
  return null;
}

module.exports = { SIDES, TYPES, ROLES, COLUMNS, column, ends, refusal };
