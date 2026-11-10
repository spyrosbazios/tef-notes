// The assistant's hands in the app (`@/core/assistant`): the page context every request carries, read at send time from
// the last screen before Ask and the phone's own copy of the notes and tasks; and the UI tools the server
// streams without an `execute` (open_note, open_task, go_view), done here with expo-router and answered with
// an `UiOutput`. They change what the owner sees, never their data. Where each goes: `destination` in store/assistant.ts.
// ask_choice is not done here: the owner answers it, from the buttons the chat draws (ui/chat/choice.tsx).
import { isToolUIPart, lastAssistantMessageIsCompleteWithApprovalResponses, lastAssistantMessageIsCompleteWithToolCalls, getToolName, type UIMessage } from "ai";
import { router, usePathname } from "expo-router";
import { useEffect } from "react";
import { isAskTool, isSelectionTool, isUiTool, UI_OK, uiError, type AssistantContext, type UiOutput } from "@/core/assistant";
import { contextFor, destination, isDestination, useAssistant, type AppTool, type Look } from "@/store/assistant";
import { getNote } from "@/store/db";
import { activeLensNow } from "@/store/lenses";
import { useNotes } from "@/store/notes";
import { usePrefs } from "@/store/prefs";
import { useTodo } from "@/store/todo";
import { openNote } from "@/ui/note";
import { openTask, openTaskList } from "@/ui/tasks";

/** The screen the owner was last on before Ask (or its past chats): what "this note", "this list" mean there. */
let pathname = "/";
const OWN = new Set(["/ask", "/chats"]);
/** Mounted once in the root layout: keeps `pathname` on the last screen that isn't the chat's own. */
export function useRouteSeen() {
  const p = usePathname();
  useEffect(() => { if (!OWN.has(p)) pathname = p; }, [p]);
}

function look(): Look {
  const { notes, list } = useNotes.getState(), { tasks } = useTodo.getState();
  return {
    pathOf: (id) => list.find((n) => n.id === id)?.path,
    note: (path) => { const n = notes[path]; return n ? { title: n.title, kind: n.kind, rev: getNote(path)?.rev ?? undefined } : undefined; },
    task: (id) => tasks[id],
    tags: usePrefs.getState().notesTags,
    list: useAssistant.getState().list,
    lens: activeLensNow(),
  };
}

/** What is on screen now: called by the transport for every request, so it is never the screen a chat began on. */
export const screenContext = (): AssistantContext => contextFor(pathname, look());

export const isAppTool = (name: string): name is AppTool => isUiTool(name) && !isAskTool(name) && !isSelectionTool(name) && name !== "draw";

/** Do a UI tool call in the app. Always an answer: a call left without one is closed as an error on the next send. */
export function runUiTool(name: AppTool, input: unknown): UiOutput {
  const d = destination(name, input, look());
  if (!isDestination(d)) return d;
  try {
    switch (d.to) {
      case "note": openNote(d.path); break;
      case "task": openTask(d.id); break;
      case "home": router.navigate("/home"); break;
      case "settings": router.navigate("/settings"); break;
      case "notes": usePrefs.getState().set({ notesTags: d.tags }); router.navigate("/home"); break;
      case "list": openTaskList(d.list); break;
      case "ask": router.navigate("/ask"); break;
    }
  } catch (e) {
    return uiError(e instanceof Error ? e.message : String(e));
  }
  return UI_OK;
}

/** The last step's parts: what came after the newest `step-start`. */
function lastStep(m: UIMessage | undefined) {
  if (m?.role !== "assistant") return [];
  const at = m.parts.findLastIndex((p) => p.type === "step-start");
  return m.parts.slice(at + 1);
}

/** Whether the turn goes on by itself: a confirm card answered, or a UI tool done here. Not any finished tool call: a turn
 *  the server cut off after a step of its own tools would be sent again and again. */
export function resumes(o: { messages: UIMessage[] }): boolean {
  if (lastAssistantMessageIsCompleteWithApprovalResponses(o)) return true;
  const ui = lastStep(o.messages.at(-1)).some((p) => isToolUIPart(p) && isUiTool(getToolName(p)));
  return ui && lastAssistantMessageIsCompleteWithToolCalls(o);
}
