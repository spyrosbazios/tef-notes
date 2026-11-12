// The model key (`llm`: the TEF_NOTES_PROVIDER's, models.ts), the search key (`exa`) and the VAPID private key (`push`,
// push.ts): each directory is mounted read-only at /run/<name>/
// (docker-compose.yml; TEF_NOTES_KEYS_DIR moves /run) and read on every use, so a new key needs no restart. No key: the
// agent, its web search or push reminders are unavailable.
// Never logged.

export type KeyName = "llm" | "exa" | "push";

export async function key(name: KeyName): Promise<string | undefined> {
  try {
    return (await Bun.file(`${process.env.TEF_NOTES_KEYS_DIR ?? "/run"}/${name}/api-key`).text()).trim() || undefined;
  } catch {
    return undefined;
  }
}
