// The agent is the server's (the sidecar under /agent, beside PocketBase): the model keys, the prompt, the tools, the
// web guard. The phone sends the chat with this phone's choices — which model, its effort, and whether note writes skip
// the confirm card — plus what is on screen (the assistant's page context, src/agent/ui-tools.ts), and draws the
// stream that comes back. expo/fetch, not RN's fetch: RN's can't stream a response body.
import { useQuery } from "@tanstack/react-query";
import { DefaultChatTransport, type UIMessage } from "ai";
import { fetch as expoFetch } from "expo/fetch";
import { screenContext } from "@/agent/ui-tools";
import { effortOf, pickModel, type AgentModels } from "@/core/agent";
import { agentModels, agentUrl } from "@/core/pocketbase";
import { ensureChat } from "./chats";
import { serverOf, useKeys } from "./keys";
import { usePrefs } from "./prefs";
import { queryClient } from "./query";

const modelsKey = (server?: string) => ["agent-models", server ?? ""] as const;

/** What the server's agent offers: its models, `available` when it holds the key. */
export function useAgentModels() {
  const server = useKeys((s) => s.keys.server);
  return useQuery({ queryKey: modelsKey(server), queryFn: () => agentModels({ url: server! }), enabled: !!server, staleTime: 60_000 });
}

/** The model this phone's next message goes to, resolved against what the server offers; undefined until it says,
 *  or when it holds no key at all. */
export function useModel() {
  const q = useAgentModels(), chosen = usePrefs((s) => s.agentModelId);
  return { model: pickModel(q.data, chosen), models: q };
}

/** Every request — a send, a regenerate, the resend after a confirm card or a UI tool — goes to the server set now, names
 *  its chat (made first if it's new) and carries the prefs and the screen as they are now. */
export const transport = new DefaultChatTransport<UIMessage>({
  api: "/agent/chat",                                                     // replaced per request: the server can change
  fetch: expoFetch as unknown as typeof globalThis.fetch,
  prepareSendMessagesRequest: async ({ id, messages }) => {
    const s = serverOf();
    if (!s) throw new Error("Set the notes server in Settings.");
    const { agentModelId, agentWritesWithoutAsking, agentEffort } = usePrefs.getState();
    const offered = await queryClient.ensureQueryData<AgentModels>({ queryKey: modelsKey(s.url), queryFn: () => agentModels(s) });
    const model = pickModel(offered, agentModelId);
    if (!model) throw new Error(`The server holds no ${offered.provider} key: add it there.`);
    await ensureChat(s, id, messages);
    return { api: agentUrl(s, "chat"), body: { id, messages, model, writesWithoutAsking: agentWritesWithoutAsking, effort: effortOf(agentEffort), context: screenContext() } };
  },
});
