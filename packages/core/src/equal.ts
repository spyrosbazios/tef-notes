// The one "is this the same value?" of the core: two JSON values compared whatever an object's key order, since the server sends
// an object's keys sorted and a client keeps them in the order it set them (a task, a preference read back after a save).

const keys = (o: object) => Object.keys(o).filter((k) => (o as Record<string, unknown>)[k] !== undefined);

/** Equal as JSON values: the same primitives, arrays equal item by item, objects with the same keys holding equal values (a key
 *  holding `undefined` is no key, as in JSON). */
export function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => equal(x, b[i]));
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const ka = keys(a), kb = keys(b);
  return ka.length === kb.length && ka.every((k) => equal((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
