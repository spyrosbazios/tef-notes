// The assistant's phone half of `@/core/assistant`, the parts with no React Native in them: what is on screen as an `AssistantContext`, and where a UI tool asks to go. The
// chat itself stays `useChats`' (store/chats.ts) and the transport's (store/agent.ts); the Ask tab (src/app/(tabs)/ask.tsx) draws it and src/agent/ui-tools.ts navigates.
import { create } from "zustand";
import { goView, LIMITS, TASK_LISTS, type AssistantContext, type AssistantView, type TaskList, type UiOutput, type UiToolInput, type SelectionToolName, type UiToolName, uiError } from "@/core/assistant";
import { contextFilter, type Lens } from "@/core/lens";
import { NO_TAG } from "@/core/note-groups";
import { isNotePath, NOTES } from "@/core/notes";

type S = {
  /** The page the Tasks tab shows (`TASK_LISTS` keys in ui/tasks.tsx), for the context. */
  list: string | null;
};

export const useAssistant = create<S>()(() => ({ list: null }));

/** What the context and the tools look up, as the phone holds it now (the live wiring is src/agent/ui-tools.ts). */
export type Look = {
  /** A note's path by its id (the file name), when this phone has it. */
  pathOf: (id: string) => string | undefined;
  note: (path: string) => { title: string; rev?: number } | undefined;
  task: (id: string) => { title: string } | undefined;
  /** Home's notes tag filter: none all, `NO_TAG` the untagged, else the tags shown. */
  tags: string[];
  /** The Tasks tab's page. */
  list: string | null;
  /** The lens that is on (core/lens.ts); the context says so in `filter`, so the assistant scopes to it. */
  lens: Lens | null;
};

const cut = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, LIMITS.title);
const isList = (k: string | null): k is TaskList => !!k && (TASK_LISTS as readonly string[]).includes(k);
/** The route's two segments: `/note/<id>` → ["note", "<id>"]. */
const parts = (pathname: string) => pathname.split("/").filter(Boolean).map(decodeURIComponent);

/** The context for the screen at `pathname` (expo-router's, `/note/<id>`, `/today`, …). A task reads as the Tasks tab's
 *  page it was opened from. */
export function contextFor(pathname: string, look: Look): AssistantContext {
  const [screen, id = ""] = parts(pathname);
  const filter = contextFilter(look.lens);
  const at = (view: AssistantView, more: Omit<AssistantContext, "view" | "client"> = {}): AssistantContext => ({ client: "phone", view, ...(filter ? { filter } : {}), ...more });
  const note = (path: string) => {
    const n = look.note(path);
    return isNotePath(path) && n ? { path, title: cut(n.title), ...(n.rev != null ? { rev: n.rev } : {}) } : undefined;
  };
  const list: AssistantView = { kind: isList(look.list) ? look.list : "today" };
  switch (screen) {
    case "home": return at(look.tags.length === 1 && look.tags[0] !== NO_TAG ? { kind: "tag", tag: look.tags[0] } : { kind: "home" });
    case "today": return at(list);
    case "settings": return at({ kind: "settings" });
    case "chats": return at({ kind: "ask" });
    case "note": return at({ kind: "notes" }, { note: note(look.pathOf(id) ?? `${NOTES}${id}.md`) });
    case "task": {
      const t = look.task(id);
      return at(list, t ? { task: { id, title: cut(t.title) } } : {});
    }
    default: return at({ kind: "home" });
  }
}

/** The UI tools the app does by itself: all but the question the owner answers (ui/chat/choice.tsx), the selection
 *  tools, which the phone never sends the editable selection for, and `draw`, offered to the web only (it has the editor). */
export type AppTool = Exclude<UiToolName, "ask_choice" | SelectionToolName | "draw">;

/** Where a UI tool takes the owner: a screen, the full chat, or why the phone can't. */
export type Destination =
  | { to: "note"; path: string } | { to: "task"; id: string }
  | { to: "home" | "settings" | "ask" } | { to: "notes"; tags: string[] } | { to: "list"; list: TaskList };

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** The screen a UI tool call asks for, checked against what this phone holds; an `UiOutput` error when there is none. The
 *  phone has no pinned or memory view: those are said, not guessed at. */
export function destination(name: AppTool, raw: unknown, look: Look): Destination | UiOutput {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  switch (name) {
    case "open_note": {
      const path = str(input.path);
      if (!isNotePath(path)) return uiError(`Not a note's path: ${path || "none given"}.`);
      if (!look.note(path)) return uiError("That note isn't on this phone.");
      return { to: "note", path };
    }
    case "open_task": {
      const id = str(input.id);
      return look.task(id) ? { to: "task", id } : uiError("That task isn't on this phone.");
    }
    case "go_view": {
      const view = goView(input as UiToolInput["go_view"]);
      if (!view) return uiError("Which tag? go_view to a tag needs one.");
      switch (view.kind) {
        case "home": return { to: "home" };
        case "notes": return { to: "notes", tags: [] };
        case "tag": return { to: "notes", tags: [view.tag] };
        case "settings": return { to: "settings" };
        case "ask": return { to: "ask" };
        case "pinned": case "memory": return uiError(`The phone has no ${view.kind} view.`);
        default: return { to: "list", list: view.kind };
      }
    }
  }
}

export const isDestination = (d: Destination | UiOutput): d is Destination => "to" in d;
