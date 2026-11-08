// The agent as state: the models the server offers, this browser's choice of one, of its effort and of whether notes are
// written without asking (localStorage: per browser, like a phone's setting), and the saved chats.
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import * as agent from "@/services/agent";
import { effortOf, pickModel, type AgentModels, type Effort } from "@/core/agent";
import { persisted } from "./store";

export const CHATS = ["chats"] as const;

const MODELS = ["agent-models"] as const;

export const useModels = () => useQuery({ queryKey: MODELS, queryFn: agent.models, staleTime: 60_000 });

export const useChats = () => useQuery({ queryKey: CHATS, queryFn: agent.chats });

export function useRemoveChat() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: agent.removeChat, onSuccess: () => qc.invalidateQueries({ queryKey: CHATS }) });
}

type Prefs = { model?: string; unasked: boolean; effort: Effort };
const stored = persisted<Prefs>("tefnotes.agent", (p) => ({
  unasked: p.unasked === true, model: typeof p.model === "string" && p.model ? p.model : undefined, effort: effortOf(p.effort),
}));

/** This browser's agent settings; `set` merges and tells every hook using them. */
export const useAgentPrefs = stored.use;

/** The current choice, resolved against what the server offers. */
export function useModel() {
  const { data } = useModels();
  const [prefs, set] = useAgentPrefs();
  const model = useMemo(() => pickModel(data, prefs.model), [data, prefs.model]);
  return { model, models: data, unasked: prefs.unasked, effort: prefs.effort, set };
}

/** What a request to the agent carries from this browser's settings, read as it is sent: a reply resumed by a card's
 *  answer goes out without a call of ours, so it can't be handed these. */
export const settingsNow = (qc: QueryClient) => ({
  model: pickModel(qc.getQueryData<AgentModels>(MODELS), stored.read().model),
  writesWithoutAsking: stored.read().unasked,
  effort: stored.read().effort,
});
