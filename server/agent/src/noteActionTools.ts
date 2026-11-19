// The agent's tools over the owner's note actions (@/core/note-actions): the saved prompts a note's buttons run. It lists
// them and, when the owner asks for a button of their own, saves one: a new action, or a change to one there. A saved prompt is
// run later, by a press, with write tools, so it is the last place a page's instructions should reach: the tool is withdrawn
// once the turn has read someone else's text (its policy), as memory is. A new action lands in the note's menu; the header is
// the owner's to arrange.
import { tool } from "ai";
import { z } from "zod";
import { ACTION_ICONS, LIMITS, newActionId, promptProblem, RESULTS, type PromptAction } from "@/core/note-actions";
import type { Server } from "@/core/pocketbase";
import { withPatch } from "@/core/prefs";
import { ownerPrefs, saveOwnerPrefs } from "./prefs";
import type { Policies } from "./tool-policy";

export type SaveInput = { id?: string; label: string; prompt: string; result: PromptAction["result"]; icon?: PromptAction["icon"] };

/** Why save_note_action can't go ahead, or null: a name and a prompt that fit, an id that exists, room for one more. Checked
 *  before the confirm card too. */
export async function saveProblem(server: Server, i: SaveInput): Promise<string | null> {
  const bad = promptProblem(i);
  if (bad) return bad;
  const { noteActions } = (await ownerPrefs(server)).prefs;
  if (i.id && !noteActions.some((a) => a.id === i.id)) return `No note action ${i.id}. Take the id from list_note_actions, or leave it out to add a new one.`;
  if (!i.id && noteActions.length >= LIMITS.actions) return `There are ${LIMITS.actions} note actions already, the most there can be. Change one, or the owner deletes one in Settings.`;
  return null;
}

export function noteActionTools(server: Server) {
  return {
    list_note_actions: tool({
      description: "The owner's note actions: the buttons on a note that run a saved prompt on it (Settings → Notes). Each has an id, a name, its prompt and what it does.",
      inputSchema: z.object({}),
      execute: async () => ({ actions: (await ownerPrefs(server)).prefs.noteActions }),
    }),

    save_note_action: tool({
      description: "Save a note action: a button on every note that runs this prompt on the open note. Only when the owner asks for such a button or shortcut; list_note_actions first. Without `id` it adds one, with an `id` it changes that one. The owner sees it and must confirm.",
      inputSchema: z.object({
        id: z.string().optional().describe("An existing action's id, to change it; omit to add a new one"),
        label: z.string().trim().min(1).max(LIMITS.label).describe("The button's name, two or three words: \"Summarise\", \"Checklist it\""),
        prompt: z.string().trim().min(1).max(LIMITS.prompt).describe("The instruction run on the open note, written to the assistant and about \"this note\", with the limits the owner gave (\"invent nothing\")"),
        result: z.enum(RESULTS).describe("What it does: edit rewrites this note (shown as a diff first), task makes a task from it, answer only replies"),
        icon: z.enum(ACTION_ICONS).optional().describe("The button's icon"),
      }),
      execute: async (i) => {
        const bad = await saveProblem(server, i);
        if (bad) return { error: bad };
        const { rec, prefs } = await ownerPrefs(server), all = prefs.noteActions, old = all.find((a) => a.id === i.id);
        const action: PromptAction = {
          id: old?.id ?? newActionId(i.label, all.map((a) => a.id)), label: i.label, prompt: i.prompt, result: i.result, icon: i.icon ?? old?.icon ?? "sparkles",
        };
        await saveOwnerPrefs(server, rec, withPatch(prefs, { noteActions: old ? all.map((a) => (a === old ? action : a)) : [...all, action] }));
        return { saved: action, where: old ? "Changed where it already sits." : "It is in every note's menu now. The owner pins it to the header from that menu or in Settings → Notes." };
      },
    }),
  };
}

export const noteActionPolicies = {
  list_note_actions: { approval: "none", result: "plain" },
  save_note_action: { approval: "noteActions", result: "plain", unavailableWhenTainted: true, check: ({ notes }, i) => saveProblem(notes.server, i) },
} satisfies Policies<ReturnType<typeof noteActionTools>>;
