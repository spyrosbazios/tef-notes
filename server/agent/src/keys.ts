// The model key (`llm`: the TEF_NOTES_PROVIDER's, models.ts), the search key (`exa`), the VAPID private key (`push`,
// push.ts) and the speech key (`fish`: Fish Audio's, for dictation and Talk): each directory is mounted read-only at /run/<name>/
// (docker-compose.yml; TEF_NOTES_KEYS_DIR moves /run) and read on every use, so a new key needs no restart. No key: the
// agent, its web search, push reminders or voice are unavailable.
// Never logged.

export type KeyName = "llm" | "exa" | "push" | "fish";

export async function key(name: KeyName): Promise<string | undefined> {
  try {
    return (await Bun.file(`${process.env.TEF_NOTES_KEYS_DIR ?? "/run"}/${name}/api-key`).text()).trim() || undefined;
  } catch {
    return undefined;
  }
}
