// The chat model. One provider per server, chosen by TEF_NOTES_PROVIDER (default deepseek); its key is the `llm` one
// (keys.ts), for Ollama TEF_NOTES_OLLAMA_URL instead. The client picks one of the provider's models (GET /agent/models
// lists them); without a key the agent is unavailable. PocketBase's hooks call the same provider and model over plain
// HTTP: server/pb_hooks/lib/llm.js, whose table must agree with PROVIDERS here (server/test/llm.test.js checks).
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

type Provider = {
  label: string;
  /** The model a chat goes to when TEF_NOTES_MODEL is unset; "" when the provider has none (Ollama: whatever is pulled). */
  model: string;
  /** The OpenAI-style base the model list is read from (`<base>/models`). */
  base: string;
  /** Ollama: no key, the URL is the set-up. */
  keyless?: boolean;
  make: (apiKey: string, base: string) => (id: string) => LanguageModel;
  options: ProviderOptions;
  /** Headers for the model list; default a bearer key. */
  listHeaders?: (apiKey: string) => Record<string, string>;
  /** The provider's models that take no images (a picture sent to one is an error): its others do. */
  blind?: (id: string) => boolean;
};

/** Exported for server/test/llm.test.js, which holds the hooks' copy to it. No reasoning option here: a provider option
 *  overrides the request's portable `reasoning` (the effort pick, agent.ts), so it would pin every message. */
export const PROVIDERS = {
  deepseek: {
    label: "DeepSeek", model: "deepseek-flash", base: "https://api.deepseek.com",
    make: (apiKey) => createDeepSeek({ apiKey }), options: {},   // its prompt cache is automatic
    blind: (id) => /pro/i.test(id),   // only Flash takes images (api-docs.deepseek.com/guides/vision)
  },
  anthropic: {
    label: "Anthropic", model: "claude-sonnet-5-5", base: "https://api.anthropic.com/v1",
    make: (apiKey) => createAnthropic({ apiKey }),
    options: { anthropic: { cacheControl: { type: "ephemeral" } } },   // caches the prompt and tools; Anthropic caches nothing unasked
    listHeaders: (apiKey) => ({ "x-api-key": apiKey, "anthropic-version": "2023-06-01" }),
  },
  openai: {
    label: "OpenAI", model: "gpt-6-luna", base: "https://api.openai.com/v1",
    make: (apiKey) => createOpenAI({ apiKey }), options: {},   // the Responses API: its models call tools only there
  },
  xai: {
    label: "Grok", model: "grok-4.7", base: "https://api.x.ai/v1",
    make: (apiKey) => createXai({ apiKey }), options: {},
  },
  qwen: {
    label: "Qwen", model: "qwen-plus", base: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    make: (apiKey, base) => createAlibaba({ apiKey, baseURL: base }), options: {},
  },
  zai: {
    label: "Z.ai", model: "glm-5.3", base: "https://api.z.ai/api/paas/v4",
    make: (apiKey, base) => { const p = createOpenAICompatible({ name: "zai", apiKey, baseURL: base }); return (id) => p(id); },
    options: {},
  },
  ollama: {
    label: "Ollama", model: "", base: "", keyless: true,
    make: (_, base) => { const p = createOpenAICompatible({ name: "ollama", baseURL: base }); return (id) => p(id); },
    options: {},
  },
} satisfies Record<string, Provider>;

export type ProviderId = keyof typeof PROVIDERS;

const isProvider = (s: string): s is ProviderId => Object.hasOwn(PROVIDERS, s);

const chosen = process.env.TEF_NOTES_PROVIDER || "deepseek";
if (!isProvider(chosen)) throw new Error(`TEF_NOTES_PROVIDER=${chosen}: not one of ${Object.keys(PROVIDERS).join(", ")}`);
const P: Provider = PROVIDERS[chosen];

/** Ollama's base: its URL with the OpenAI-style /v1 it serves; a provider's base otherwise (TEF_NOTES_LLM_URL overrides, e.g. Qwen's region). */
const BASE = chosen === "ollama"
  ? (process.env.TEF_NOTES_OLLAMA_URL ? `${process.env.TEF_NOTES_OLLAMA_URL.replace(/\/+$/, "")}/v1` : "")
  : (process.env.TEF_NOTES_LLM_URL || P.base).replace(/\/+$/, "");

export const DEFAULT = process.env.TEF_NOTES_MODEL || P.model;
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
