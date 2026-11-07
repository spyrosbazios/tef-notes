// The writing model, the server's one provider as the chat agent calls it (server/agent/src/models.ts: the same
// TEF_NOTES_PROVIDER, model and key; that file's PROVIDERS and this one's must agree, server/test/llm.test.js checks).
// Used by the clip save (clip.pb.js) to write up the owner's note on a clip and, when the owner ticks "Add a summary",
// to summarise what was clipped, and by the tag describer (tags.pb.js) to write a tag's description when asked; nothing
// else on the server writes text.
//
// Every provider but Anthropic takes OpenAI-style Chat Completions (no tools are sent, so OpenAI's needn't be the
// Responses API). The key is the `llm` one (lib/keys.js); Ollama has none, TEF_NOTES_OLLAMA_URL instead. TEF_NOTES_MODEL
// and TEF_NOTES_LLM_URL override the model and the base URL.

const { env } = require("./env.js");

/** `base`: the API root (`/chat/completions`, or Anthropic's `/messages`, is added); `body`: what the provider adds. */
const PROVIDERS = {
  deepseek: { label: "DeepSeek", model: "deepseek-flash", base: "https://api.deepseek.com", body: { reasoning_effort: "low" } },
  anthropic: { label: "Anthropic", model: "claude-sonnet-5-5", base: "https://api.anthropic.com/v1", body: {} },
  openai: { label: "OpenAI", model: "gpt-6-luna", base: "https://api.openai.com/v1", body: { reasoning_effort: "low" } },
  xai: { label: "Grok", model: "grok-4.7", base: "https://api.x.ai/v1", body: {} },
  qwen: { label: "Qwen", model: "qwen-plus", base: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", body: {} },
  zai: { label: "Z.ai", model: "glm-5.3", base: "https://api.z.ai/api/paas/v4", body: {} },
  ollama: { label: "Ollama", model: "", base: "", body: {}, keyless: true },
};

const trim = (u) => u.replace(/\/+$/, "");

/** The writer for provider `name`, set up from `get` (an env reader). Unknown names throw. */
function make(name, get = env) {
  const p = PROVIDERS[name];
  if (!p) throw new Error(`TEF_NOTES_PROVIDER=${name}: not one of ${Object.keys(PROVIDERS).join(", ")}`);
  const base = name === "ollama" ? (get("TEF_NOTES_OLLAMA_URL") ? `${trim(get("TEF_NOTES_OLLAMA_URL"))}/v1` : "") : trim(get("TEF_NOTES_LLM_URL") || p.base);
  const model = get("TEF_NOTES_MODEL") || p.model;
  const anthropic = name === "anthropic";

  /** The credential to send: the key read by `read` (lib/keys.js), for Ollama "-" once it is set up; "" when it isn't. */
  const credential = (read) => (p.keyless ? (base && model ? "-" : "") : read("llm"));

  /** The `$http.send` options for one chat: `system` and `user` are the two messages. */
  const request = (key, system, user, timeout = 60) => anthropic
    ? {
      url: `${base}/messages`, method: "POST", timeout,
      body: JSON.stringify({ model, max_tokens: 4096, system, messages: [{ role: "user", content: user }] }),
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    }
    : {
      url: `${base}/chat/completions`, method: "POST", timeout,
      body: JSON.stringify({ model, ...p.body, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
      headers: p.keyless ? { "Content-Type": "application/json" } : { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    };

  /** The answer's text, "" when there is none. */
  function text(json) {
    if (anthropic) {
      const parts = json && Array.isArray(json.content) ? json.content.filter((c) => c && c.type === "text" && typeof c.text === "string") : [];
      return parts.map((c) => c.text).join("").trim();
    }
    const c = json && Array.isArray(json.choices) && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
    return typeof c === "string" ? c.trim() : "";
  }

  return { name, label: p.label, model, base, credential, request, text };
}

/** The server's provider. Built on each require, inside the handler that needs it (a PocketBase handler sees no top-level scope). */
const llm = () => make(env("TEF_NOTES_PROVIDER") || "deepseek");

module.exports = { PROVIDERS, make, llm };
