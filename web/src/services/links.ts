// Link replay and duplicate recovery are shared with the fetch client.
import { links } from "@/core/record-protocol";
import type { Link } from "@/core/record-links";
import { recordTransport } from "./records";

export const ids = () => links.ids(recordTransport);
export const byIds = (want: string[]) => links.byIds(recordTransport, want);
export const add = (l: Link) => links.add(recordTransport, l);
export const remove = (id: string) => links.remove(recordTransport, id);
