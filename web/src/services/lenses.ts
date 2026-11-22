// Lens definitions on the server (core/lens.ts) through the shared protocol (core/record-protocol.ts `lenses`). Which lens is on
// is a preference (hooks/lens.ts).
import { recordId } from "@/core/client/ids";
import type { LensFields } from "@/core/lens";
import { lenses } from "@/core/record-protocol";
import { directTransport } from "./records";

export const list = () => lenses.list(directTransport);
/** Conflict: a lens by that name (ignoring case) exists. */
export const create = (l: LensFields) => lenses.create(directTransport, l, recordId());
export const update = (rec: string, l: LensFields) => lenses.update(directTransport, rec, l);
/** Already gone is done. */
export const remove = (rec: string) => lenses.remove(directTransport, rec);
