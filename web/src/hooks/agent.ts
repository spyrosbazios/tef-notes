// The agent as state: the models the server offers, the choice of one, of its effort and of whether notes are
// written without asking (the owner's preferences, hooks/prefs.ts), and the saved chats.
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import * as agent from "@/services/agent";
import { pickModel, type AgentModels } from "@/core/agent";
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

type AgentPrefs = Prefs["agent"];
const setAgent = (patch: Partial<AgentPrefs>) => setPrefs({ agent: { ...prefsNow().agent, ...patch } });

/** The current choice, resolved against what the server offers. */
export function useModel() {
  const { data } = useModels();
  const prefs = usePrefs().agent;
  const model = useMemo(() => pickModel(data, prefs.model), [data, prefs.model]);
  return { model, models: data, unasked: prefs.unasked, effort: prefs.effort, set: setAgent };
}

/** What a request to the agent carries from the settings, read as it is sent: a reply resumed by a card's
 *  answer goes out without a call of ours, so it can't be handed these. */
export const settingsNow = (qc: QueryClient) => ({
  model: pickModel(qc.getQueryData<AgentModels>(MODELS), prefsNow().agent.model),
  writesWithoutAsking: prefsNow().agent.unasked,
  effort: prefsNow().agent.effort,
});
