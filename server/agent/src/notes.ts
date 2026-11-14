// Assistant presentation over the request-scoped application service. No persistence lives here.
import { z } from "zod";
import { noteCardOf, type NoteCard } from "@/core/agent";
import { isNotePath } from "@/core/notes";
import type { Server } from "@/core/pocketbase";
import { NoteService, type NoteSaved } from "./application/notes";
export { definedTags, time, type Meta, type Hit } from "./application/notes";
export type Saved = { saved: string; rev: number; card?: NoteCard } | { error: string };

function present(result: NoteSaved): Saved {
  if ("error" in result) return result;
  const { text, ...saved } = result;
  return { ...saved, ...(isNotePath(saved.saved) ? { card: noteCardOf(saved.saved, text) } : {}) };
}

export class Notes {
  readonly service: NoteService;
  constructor(readonly server: Server) { this.service = new NoteService(server); }
  all(...args: Parameters<NoteService["all"]>) { return this.service.all(...args); }
  meta(...args: Parameters<NoteService["meta"]>) { return this.service.meta(...args); }
  list(...args: Parameters<NoteService["list"]>) { return this.service.list(...args); }
  tainted(...args: Parameters<NoteService["tainted"]>) { return this.service.tainted(...args); }
  tags(...args: Parameters<NoteService["tags"]>) { return this.service.tags(...args); }
  read(...args: Parameters<NoteService["read"]>) { return this.service.read(...args); }
  search(...args: Parameters<NoteService["search"]>) { return this.service.search(...args); }
  remove(...args: Parameters<NoteService["remove"]>) { return this.service.remove(...args); }
  async create(...args: Parameters<NoteService["create"]>): Promise<Saved> { return present(await this.service.create(...args)); }
  async change(...args: Parameters<NoteService["change"]>): Promise<Saved> { return present(await this.service.change(...args)); }
}

/** A tag list an agent tool takes, for notes and tasks alike. */
export const TAGS = z.array(z.string().min(1).max(40)).max(10).describe("Only tags list_tags returns (defined in Settings or already on a note). Never invent one");
