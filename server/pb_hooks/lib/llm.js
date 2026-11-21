// The writing model, the server's one provider as the chat agent calls it: which provider, its model and its base are
// server/agent/src/providers.ts's (through lib/core.js), the same TEF_NOTES_PROVIDER, model and key as the chat's.
// The hooks' one writing model: the clip save (clip.pb.js) writes up the owner's note on a clip and, when the owner ticks
// "Add a summary", summarises what was clipped; the Summary button's route (summary.pb.js) summarises a linked page; the
// tag describer (tags.pb.js) writes a tag's description when asked, and the hourly job one where there is none or its own.
//
// Every provider but Anthropic takes OpenAI-style Chat Completions (no tools are sent, so OpenAI's needn't be the
// Responses API). The key is the `llm` one (lib/keys.js); Ollama has none, TEF_NOTES_OLLAMA_URL instead.

const { env } = require("./env.js");
const { baseOf, modelOf, providerOf, PROVIDERS } = require("./core.js");

/** What a provider's Chat Completions body adds for the hooks' short write-ups. The chat agent sets none: a provider
 *  option there would override the effort the owner picks per message. */
const BODY = { deepseek: { reasoning_effort: "low" }, openai: { reasoning_effort: "low" } };

/** The writer for provider `name`, set up from `get` (an env reader). Unknown names throw. */
function make(name, get = env) {
  const id = providerOf((k) => (k === "TEF_NOTES_PROVIDER" ? name : get(k))), p = PROVIDERS[id];
  const base = baseOf(id, get), model = modelOf(id, get), extra = BODY[id] || {};
  const anthropic = id === "anthropic";

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
      body: JSON.stringify({ model, ...extra, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
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

  return { name: id, label: p.label, model, base, credential, request, text };
}

/** The server's provider. Built on each require, inside the handler that needs it (a PocketBase handler sees no top-level scope). */
const llm = () => make(providerOf(env));

module.exports = { make, llm };
