// The server's one writing provider, as both its callers name it: the chat agent (models.ts, over the AI SDK) and
// PocketBase's hooks (server/pb_hooks/lib/llm.js, over plain HTTP, through the hooks' bundle of this file:
// server/pb_hooks/bundle). TEF_NOTES_PROVIDER picks it (default deepseek); TEF_NOTES_MODEL and TEF_NOTES_LLM_URL override
// its model and base, and Ollama's base is TEF_NOTES_OLLAMA_URL. Pure: no I/O, so PocketBase's JS VM runs it too.

export type ProviderInfo = {
  label: string;
  /** The model a chat goes to when TEF_NOTES_MODEL is unset; "" when the provider has none (Ollama: whatever is pulled). */
  model: string;
  /** The OpenAI-style API root (`<base>/models`, `<base>/chat/completions`; Anthropic's `<base>/messages`). */
  base: string;
  /** Ollama: no key, the URL is the set-up. */
  keyless?: boolean;
};

export const PROVIDERS = {
  deepseek: { label: "DeepSeek", model: "deepseek-flash", base: "https://api.deepseek.com" },
  anthropic: { label: "Anthropic", model: "claude-sonnet-5-5", base: "https://api.anthropic.com/v1" },
  openai: { label: "OpenAI", model: "gpt-6-luna", base: "https://api.openai.com/v1" },
  xai: { label: "Grok", model: "grok-4.7", base: "https://api.x.ai/v1" },
  qwen: { label: "Qwen", model: "qwen-plus", base: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1" },
  zai: { label: "Z.ai", model: "glm-5.3", base: "https://api.z.ai/api/paas/v4" },
  ollama: { label: "Ollama", model: "", base: "", keyless: true },
} satisfies Record<string, ProviderInfo>;

export type ProviderId = keyof typeof PROVIDERS;

/** An environment variable's value; unset is undefined or "". */
export type Env = (name: string) => string | undefined;

export const isProvider = (s: string): s is ProviderId => Object.hasOwn(PROVIDERS, s);

/** The provider TEF_NOTES_PROVIDER names, deepseek when unset. Throws on one there is none of. */
export function providerOf(env: Env): ProviderId {
  const name = env("TEF_NOTES_PROVIDER") || "deepseek";
  if (!isProvider(name)) throw new Error(`TEF_NOTES_PROVIDER=${name}: not one of ${Object.keys(PROVIDERS).join(", ")}`);
  return name;
}

const trim = (u: string) => u.replace(/\/+$/, "");

/** The API root to call: Ollama's URL with the OpenAI-style /v1 it serves ("" until it is set), else the provider's,
 *  which TEF_NOTES_LLM_URL overrides (e.g. Qwen's region). */
export function baseOf(id: ProviderId, env: Env): string {
  if (id !== "ollama") return trim(env("TEF_NOTES_LLM_URL") || PROVIDERS[id].base);
  const url = env("TEF_NOTES_OLLAMA_URL");
  return url ? `${trim(url)}/v1` : "";
}

/** The model to call by default: TEF_NOTES_MODEL, else the provider's. */
export const modelOf = (id: ProviderId, env: Env) => env("TEF_NOTES_MODEL") || PROVIDERS[id].model;
