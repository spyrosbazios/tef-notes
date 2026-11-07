# AI providers

[← TEF Notes](../README.md)

Paths below are relative to the repository root.

All optional. Each key is a file `server/keys/<provider>/api-key` holding the key alone (or a directory you name in
`server/.env`, see `server/.env.example`). Keys are mounted read-only and re-read on every use, so a new key needs no
restart. The model provider is your choice; see below.

| Provider | Powers | Without it |
|---|---|---|
| `typesafe` (JEV, a vision and ranking model) | Auto-tagging and the clipper's suggestions of where a page fits | Neither does anything; you can still save a clip to a note you pick or a new one |
| The model provider (`TEF_NOTES_PROVIDER`, below) | The chat agent, the clipper's write-up and optional summary, tag descriptions | The chat is unavailable; a clip is saved as you typed it, without a summary |
| `exa` | The chat agent's web search | The agent has no web tools |

One model provider per server, chosen with `TEF_NOTES_PROVIDER` in `server/.env` (default `deepseek`); its key goes in
`server/keys/<provider>/api-key`. `TEF_NOTES_MODEL` picks another of its models; the app's model picker lists them all.

| `TEF_NOTES_PROVIDER` | Default model | Key from |
|---|---|---|
| `deepseek` | `deepseek-flash` | platform.deepseek.com |
| `anthropic` | `claude-sonnet-5-5` | console.anthropic.com |
| `openai` | `gpt-6-luna` | platform.openai.com |
| `xai` (Grok) | `grok-4.7` | console.x.ai |
| `qwen` | `qwen-plus` | Alibaba Cloud Model Studio (international; `TEF_NOTES_LLM_URL` for another region) |
| `zai` (Z.ai, GLM) | `glm-5.3` | z.ai |
| `ollama` | none: set `TEF_NOTES_MODEL` | no key: set `TEF_NOTES_OLLAMA_URL` (`http://host.docker.internal:11434` for one on the same host) |

Switching provider: set `TEF_NOTES_PROVIDER`, put the key in `server/keys/<provider>/api-key`, then
`docker compose up -d` (the variables apply when the containers are recreated). A model that calls tools reliably
matters for the chat; a small local model may not.

Whatever you send to a provider leaves your server: note text, photos the auto-tagger looks at, pages you clip. Leave
a key out to keep that feature off.
