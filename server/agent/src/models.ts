// The chat model. One provider per server, chosen by TEF_NOTES_PROVIDER (default deepseek); its key is the `llm` one
// (keys.ts), for Ollama TEF_NOTES_OLLAMA_URL instead. The client picks one of the provider's models (GET /agent/models
// lists them); without a key the agent is unavailable. Which provider, its model and its base: providers.ts, which
// PocketBase's hooks read too (server/pb_hooks/lib/llm.js calls the same provider and model over plain HTTP).
import { createAlibaba } from "@ai-sdk/alibaba";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createXai } from "@ai-sdk/xai";
import type { ProviderOptions } from "@ai-sdk/provider-utils";
import type { LanguageModel } from "ai";
import type { AgentModels } from "@/core/agent";
import { getJson } from "@/core/http";
import { key } from "./keys";
import { baseOf, modelOf, providerOf, PROVIDERS, type ProviderId, type ProviderInfo } from "./providers";

/** How the agent calls a provider (providers.ts names it, with its model and base). */
type Client = {
  make: (apiKey: string, base: string) => (id: string) => LanguageModel;
  options: ProviderOptions;
  /** Headers for the model list; default a bearer key. */
  listHeaders?: (apiKey: string) => Record<string, string>;
  /** The provider's models that take no images (a picture sent to one is an error): its others do. */
  blind?: (id: string) => boolean;
};

/** No reasoning option here: a provider option overrides the request's portable `reasoning` (the effort pick, agent.ts),
 *  so it would pin every message. */
const CLIENTS: Record<ProviderId, Client> = {
  deepseek: {
    make: (apiKey) => createDeepSeek({ apiKey }), options: {},   // its prompt cache is automatic
    blind: (id) => /pro/i.test(id),   // only Flash takes images (api-docs.deepseek.com/guides/vision)
  },
  anthropic: {
    make: (apiKey) => createAnthropic({ apiKey }),
    options: { anthropic: { cacheControl: { type: "ephemeral" } } },   // caches the prompt and tools; Anthropic caches nothing unasked
    listHeaders: (apiKey) => ({ "x-api-key": apiKey, "anthropic-version": "2023-06-01" }),
  },
  openai: { make: (apiKey) => createOpenAI({ apiKey }), options: {} },   // the Responses API: its models call tools only there
  xai: { make: (apiKey) => createXai({ apiKey }), options: {} },
  qwen: { make: (apiKey, base) => createAlibaba({ apiKey, baseURL: base }), options: {} },
  zai: {
    make: (apiKey, base) => { const p = createOpenAICompatible({ name: "zai", apiKey, baseURL: base }); return (id) => p(id); },
    options: {},
  },
  ollama: {
    make: (_, base) => { const p = createOpenAICompatible({ name: "ollama", baseURL: base }); return (id) => p(id); },
    options: {},
  },
};

const env = (name: string) => process.env[name];
const chosen = providerOf(env);
const P: ProviderInfo & Client = { ...PROVIDERS[chosen], ...CLIENTS[chosen] };
const BASE = baseOf(chosen, env);

export const DEFAULT = modelOf(chosen, env);
const KNOWN = DEFAULT ? [DEFAULT] : [];          // listed when the live list can't be had

/** The provider's credential: its key, or for Ollama a set URL (and a model to default to). undefined: not set up. */
async function credential(): Promise<string | undefined> {
  if (P.keyless) return BASE && DEFAULT ? "ollama" : undefined;
  return key("llm");
}

const HOUR = 3_600_000;
/** The live list, an hour, per key by its last 6 chars: a new key lists its own models. */
let listed: { key: string; at: number; ids: string[] } | undefined;

/** The provider's models: the live list (OpenAI-style `data[].id`, Anthropic's too), else the built-in one. */
async function ids(apiKey: string): Promise<string[]> {
  const k = apiKey.slice(-6);
  if (listed?.key === k && Date.now() - listed.at < HOUR) return listed.ids;
  try {
    const headers = P.keyless ? {} : P.listHeaders?.(apiKey) ?? { Authorization: `Bearer ${apiKey}` };
    const live = (await getJson(`${BASE}/models`, { headers }, 2, 15_000)).data.map((m: { id: string }) => m.id);
    if (live.length) { listed = { key: k, at: Date.now(), ids: live }; return live; }
  } catch { /* the built-in list below */ }
  return KNOWN;
}

/** GET /agent/models. */
export async function catalog(): Promise<AgentModels> {
  const apiKey = await credential();
  return { provider: P.label, available: !!apiKey, default: DEFAULT, models: apiKey ? await ids(apiKey) : KNOWN, web: !!(await key("exa")) };
}

/** Whether a model can be shown a picture (a drawing it made, core/assistant.ts `DrawOutput`). */
export const sees = (id: string) => !P.blind?.(id);

export class Unavailable extends Error {}

/** The model to run a chat on. Unavailable: the provider isn't set up on the server. */
export async function model(id: string) {
  const apiKey = await credential();
  if (!apiKey) throw new Unavailable(P.keyless
    ? "Ollama isn't set up on the notes server (TEF_NOTES_OLLAMA_URL and TEF_NOTES_MODEL)."
    : `${P.label} isn't set up on the notes server (no API key).`);
  return { model: P.make(apiKey, BASE)(id), providerOptions: P.options };
}
