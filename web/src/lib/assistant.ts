// The always-on assistant's side of the page, in the web app's terms (the contract is `@/core/assistant`): what is on screen
// as the `context` every request carries, and the UI tools the agent drives the app with. Pure: the nav, the cache and the
// dock come in as arguments, so this is what `test/assistant.test.ts` exercises.
import { getToolName, isToolUIPart, lastAssistantMessageIsCompleteWithApprovalResponses, lastAssistantMessageIsCompleteWithToolCalls, type UIMessage } from "ai";
import { isAskTool, isUiTool, LIMITS, uiError, UI_OK, viewFrom, type AssistantContext, type AssistantView, type UiOutput, type UiToolName } from "@/core/assistant";
import { contextFilter, type Lens } from "@/core/lens";
import { isNotePath } from "@/core/notes";
import { homeOfTask, isTaskView, titleOf, type View } from "@/lib/nav";
import type { NoteRec } from "@/services/notes";
import type { TaskRec } from "@/services/todo";

/** Where the app is, as the contract says it: Home filtered to one tag is the contract's `tag`, Settings' agent section its `memory`
 *  (`webView`'s way back), the rest of Settings its `settings`. */
export function assistantView(v: View): AssistantView {
  switch (v.kind) {
    case "home": return v.tags?.length === 1 ? { kind: "tag", tag: v.tags[0] } : { kind: "home" };
    case "settings": return { kind: v.section === "agent" ? "memory" : "settings" };
    default: return v;
  }
}

/** A view the contract names, as the web has it; null for the chat, the dock itself and not a view. Every note view is
 *  Home here (a tag's, filtered to it; pinned notes lead it anyway), and the agent's memory is a section of Settings. */
export function webView(v: AssistantView): View | null {
  if (v.kind === "tag") return { kind: "home", tags: [v.tag] };
  const { kind } = v;
  return kind === "ask" ? null : kind === "notes" || kind === "home" || kind === "pinned" ? { kind: "home" } : kind === "memory" ? { kind: "settings", section: "agent" } : { kind };
}

/** The URL's state: the open note's id and the open task's id (a task opens only in a task list). */
export type Where = { view: View; open?: string; task?: string };

/** What the cache holds. */
export type Held = { notes?: NoteRec[]; tasks?: TaskRec[] };

/** The context for a request: the view, the open note, the open task, the text selected on the page, and the lens that is on
 *  (as the `filter`: the web's lists have no filter chip of their own, and the palette closes before it is used). Read when the
 *  message goes out, so a step resumed after a card is answered sees the screen as it is then. */
export function pageContext(at: Where, held: Held, selection: string, lens?: Lens | null): AssistantContext {
  const out: AssistantContext = { client: "web", view: assistantView(at.view) };
  const note = at.open ? held.notes?.find((n) => n.note.id === at.open) : undefined;
  if (note) out.note = { path: note.path, title: note.note.title, rev: note.rev };
  const task = at.task && !at.open && isTaskView(at.view) ? held.tasks?.find((t) => t.id === at.task) : undefined;   // an open note hides the task
  if (task) out.task = { id: task.id, title: task.title };
  const text = selection.trim().slice(0, LIMITS.selection);
  if (text) out.selection = text;
  const filter = contextFilter(lens);
  if (filter) out.filter = filter;
  return out;
}

/** The UI tools the app does itself: all but `ask_choice`, which the owner answers (components/assistant/choice.tsx). */
export type AppTool = Exclude<UiToolName, "ask_choice">;
export const isAppTool = (name: string): name is AppTool => isUiTool(name) && !isAskTool(name);

/** What a UI tool needs of the app: the records it names (after a look at the server if the cache hasn't them yet, as a note
 *  the agent just wrote may not have arrived), and the nav. */
export type UiHost = {
  note: (path: string) => Promise<NoteRec | undefined>;
  task: (id: string) => Promise<TaskRec | undefined>;
  nav: {
    openNote: (id: string) => void;
    showTask: (v: View, id: string) => void;
    goView: (v: View) => void;
  };
  /** `go_view` to the chat: the dock is there already, open it. */
  showAssistant: () => void;
};

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Do one UI tool call in the app, and say how it went: `{ ok: true }`, or `{ error }` for the model to read. Always answers. */
export async function runUiTool(name: AppTool, input: unknown, host: UiHost): Promise<UiOutput> {
  const i = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  switch (name) {
    case "open_note": {
      const path = str(i.path), n = isNotePath(path) ? await host.note(path) : undefined;
      if (!n) return uiError(`No note ${path || "(none named)"}.`);
      host.nav.openNote(n.note.id);
      return UI_OK;
    }
    case "open_task": {
      const t = await host.task(str(i.id));
      if (!t) return uiError(`No task ${str(i.id) || "(none named)"}.`);
      host.nav.showTask(homeOfTask(t), t.id);
      return UI_OK;
    }
    case "go_view": {
      const to = viewFrom(i.view, { tag: i.tag });
      if (!to) return uiError(i.view === "tag" ? "A tag view needs the tag." : `No view ${str(i.view)}.`);
      const v = webView(to);
      if (v) host.nav.goView(v); else host.showAssistant();
      return UI_OK;
    }
  }
}

const CANT: Record<AppTool, string> = { open_note: "Couldn't open the note", open_task: "Couldn't open the task", go_view: "Couldn't go there" };
/** A UI tool call that failed, as a line: what it was, and `why` (the app's answer, or the error). */
export const uiTrouble = (name: AppTool, why: string) => (why ? `${CANT[name]}: ${why}` : CANT[name]);

/** The tool call as a line for the chat once it has run: "Opened note “Garage”". `title`: the record's title as the app
 *  has it now, if it still does. */
export function uiWords(name: AppTool, input: unknown, title: string | undefined): string {
  const i = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const quoted = title ? ` “${title}”` : "";
  switch (name) {
    case "open_note": return `Opened note${quoted}`;
    case "open_task": return `Opened task${quoted}`;
    case "go_view": {
      const to = viewFrom(i.view, { tag: i.tag }), v = to && webView(to);
      return v ? `Went to ${titleOf(v)}` : to ? "Opened the assistant" : "Went to a view";
    }
  }
}

/** When the turn goes on without the owner sending anything (`sendAutomaticallyWhen`): a card was answered, or every call
 *  of the last step is done and one of them was ours, a UI tool. Not merely "the step's calls are done": a reply that stopped
 *  at the server's step limit ends on finished server calls too, and resending that would start another round unasked. */
export function resumes({ messages }: { messages: UIMessage[] }): boolean {
  if (lastAssistantMessageIsCompleteWithApprovalResponses({ messages })) return true;
  if (!lastAssistantMessageIsCompleteWithToolCalls({ messages })) return false;
  const { parts } = messages[messages.length - 1];
  const step = parts.slice(parts.findLastIndex((p) => p.type === "step-start") + 1);
  return step.some((p) => isToolUIPart(p) && isUiTool(getToolName(p)));
}

/** The messages with every tool call that never finished closed as failed (one still streaming its input is dropped): what
 *  a Stop leaves, and what a saved chat may hold. The server closes them on the next send too (`settle`), so this is not for the
 *  wire: after a Stop it keeps a UI tool's late answer from resuming the turn (`addToolOutput` would, the call being still
 *  open), and in a saved chat it keeps the rows from showing a call still running that never will. */
export function closeUnfinished(ms: UIMessage[]): UIMessage[] {
  const open = (p: UIMessage["parts"][number]) => isToolUIPart(p) && (p.state === "input-streaming" || p.state === "input-available");
  if (!ms.some((m) => m.parts.some(open))) return ms;
  return ms.map((m) => (!m.parts.some(open) ? m : {
    ...m,
    parts: m.parts.flatMap((p) => {
      if (!isToolUIPart(p) || !open(p)) return [p];
      if (p.state === "input-streaming") return [];
      return [{ ...p, state: "output-error", errorText: "Stopped before it finished." }];
    }),
  } as UIMessage));
}
