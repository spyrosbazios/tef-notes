// New ids, the core's one source of randomness: the pure core is handed its ids (todo.ts addItem, clip.ts saveBodies, the records a
// client makes).

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** A record id as PocketBase makes them (15 of [a-z0-9]): a client names a new note, task, chat, lens or tag before it exists
 *  on the server, and a clip's save carries one. */
export const recordId = (): string => random(15);

/** A checklist item's id: four of [a-z0-9], short for the model to name (todo.ts addItem keeps it unique in its task). */
export const itemId = (): string => random(4);

function random(n: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => ALPHABET[b % ALPHABET.length]).join("");
}
