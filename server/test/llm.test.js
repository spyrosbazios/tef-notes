// The writing model's lib (pb_hooks/lib/llm.js): each provider's request and answer, and that its table agrees with the
// chat agent's (server/agent/src/models.ts), so the hooks and the chat use the same provider, model and endpoint.
import { describe, expect, test } from "bun:test";
import { make, PROVIDERS } from "../pb_hooks/lib/llm.js";
import { PROVIDERS as AGENT } from "../agent/src/models.ts";

const none = () => "";
const envOf = (vars) => (name) => vars[name] || "";

describe("the providers", () => {
  test("the same ones as the agent, with the same names, models and endpoints", () => {
    expect(Object.keys(PROVIDERS).sort()).toEqual(Object.keys(AGENT).sort());
    for (const [id, p] of Object.entries(PROVIDERS)) {
      expect([id, p.label, p.model, p.base]).toEqual([id, AGENT[id].label, AGENT[id].model, AGENT[id].base]);
    }
  });
  test("an unknown one is refused", () => {
    expect(() => make("nope", none)).toThrow("TEF_NOTES_PROVIDER=nope");
  });
});

describe("a request", () => {
  test("OpenAI-style: bearer key, system and user messages, the provider's extras", () => {
    const r = make("deepseek", none).request("k", "sys", "usr"), b = JSON.parse(r.body);
    expect(r.url).toBe("https://api.deepseek.com/chat/completions");
    expect(r.headers.Authorization).toBe("Bearer k");
    expect(b).toEqual({ model: "deepseek-flash", reasoning_effort: "low", messages: [{ role: "system", content: "sys" }, { role: "user", content: "usr" }] });
    expect(JSON.parse(make("zai", none).request("k", "s", "u").body).model).toBe("glm-5.3");
    expect(make("zai", none).request("k", "s", "u").url).toBe("https://api.z.ai/api/paas/v4/chat/completions");
  });
  test("Anthropic: its Messages API, x-api-key, the system prompt apart", () => {
    const r = make("anthropic", none).request("k", "sys", "usr"), b = JSON.parse(r.body);
    expect(r.url).toBe("https://api.anthropic.com/v1/messages");
    expect(r.headers["x-api-key"]).toBe("k");
    expect(r.headers.Authorization).toBeUndefined();
    expect(b).toEqual({ model: "claude-sonnet-5-5", max_tokens: 4096, system: "sys", messages: [{ role: "user", content: "usr" }] });
  });
  test("TEF_NOTES_MODEL and TEF_NOTES_LLM_URL override", () => {
    const w = make("qwen", envOf({ TEF_NOTES_MODEL: "qwen-max", TEF_NOTES_LLM_URL: "https://x.example/compatible-mode/v1/" }));
    const r = w.request("k", "s", "u");
    expect(r.url).toBe("https://x.example/compatible-mode/v1/chat/completions");
    expect(JSON.parse(r.body).model).toBe("qwen-max");
  });
});

describe("the credential", () => {
  test("the llm key", () => {
    const asked = [];
    expect(make("openai", none).credential((n) => { asked.push(n); return "sk"; })).toBe("sk");
    expect(asked).toEqual(["llm"]);
  });
  test("Ollama: no key, set up once its URL and a model are; no Authorization header", () => {
    expect(make("ollama", none).credential(() => "")).toBe("");
    expect(make("ollama", envOf({ TEF_NOTES_OLLAMA_URL: "http://gpu:11434" })).credential(() => "")).toBe("");
    const w = make("ollama", envOf({ TEF_NOTES_OLLAMA_URL: "http://gpu:11434/", TEF_NOTES_MODEL: "qwen3" }));
    expect(w.credential(() => "")).toBe("-");
    const r = w.request("-", "s", "u");
    expect(r.url).toBe("http://gpu:11434/v1/chat/completions");
    expect(r.headers.Authorization).toBeUndefined();
  });
});

describe("the answer", () => {
  test("OpenAI-style: the first choice's content, trimmed", () => {
    expect(make("xai", none).text({ choices: [{ message: { content: " hi " } }] })).toBe("hi");
    expect(make("xai", none).text({})).toBe("");
  });
  test("Anthropic: its text blocks joined", () => {
    const w = make("anthropic", none);
    expect(w.text({ content: [{ type: "thinking", thinking: "x" }, { type: "text", text: " a" }, { type: "text", text: "b " }] })).toBe("ab");
    expect(w.text({ content: "nope" })).toBe("");
  });
});
