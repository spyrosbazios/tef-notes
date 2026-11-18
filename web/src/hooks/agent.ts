// The agent as state: the models the server offers, the choice of one, of its effort and of whether notes are
// written without asking (the owner's preferences, hooks/prefs.ts), and the saved chats.
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import * as agent from "@/services/agent";
import { pickModel, type AgentModels, type Effort } from "@/core/agent";
import type { Prefs } from "@/core/prefs";
import { prefsNow, setPrefs, usePrefs } from "./prefs";

export const CHATS = ["chats"] as const;

const MODELS = ["agent-models"] as const;

export const useModels = () => useQuery({ queryKey: MODELS, queryFn: agent.models, staleTime: 60_000 });

export const useChats = () => useQuery({ queryKey: CHATS, queryFn: agent.chats });

export function useRemoveChat() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: agent.removeChat, onSuccess: () => qc.invalidateQueries({ queryKey: CHATS }) });
}

const setAgent = (patch: Partial<Prefs["agent"]>) => setPrefs({ agent: patch });

/** The current choice, resolved against what the server offers. */
export function useModel() {
  const { data } = useModels();
  const prefs = usePrefs().agent;
  const model = useMemo(() => pickModel(data, prefs.model), [data, prefs.model]);
  return { model, models: data, newChat: prefs.newChat, effort: prefs.effort, set: setAgent };
}

/** What a model menu reads and changes: Ask's choice (`useModel`) or Talk's (`useTalkModel`). `follows`: Talk's own is unset
 *  and the assistant's is used; `set({ follow: true })` goes back to that. */
export type ModelChoice = {
  model: string | null | undefined;
  models: AgentModels | undefined;
  effort: Effort;
  set: (patch: { model?: string; effort?: Effort; follow?: true }) => void;
  follows?: boolean;
};

/** Talk's model and effort (core/prefs.ts `talk.agent`), each unset following the assistant's. */
export function useTalkModel(): ModelChoice {
  const { data } = useModels();
  const prefs = usePrefs();
  const own = prefs.talk.agent;
  const model = useMemo(() => pickModel(data, own.model || prefs.agent.model), [data, own.model, prefs.agent.model]);
  return {
    model, models: data, effort: own.effort ?? prefs.agent.effort, follows: !own.model && !own.effort,
    set: (patch) => setPrefs({ talk: { agent: patch.follow ? {} : { ...prefsNow().talk.agent, ...patch } } }),
  };
}

/** What a request to the agent carries from the settings, read as it is sent: a reply resumed by a card's
 *  answer goes out without a call of ours, so it can't be handed these. */
export const settingsNow = (qc: QueryClient) => ({
  model: pickModel(qc.getQueryData<AgentModels>(MODELS), prefsNow().agent.model),
  effort: prefsNow().agent.effort,
});
