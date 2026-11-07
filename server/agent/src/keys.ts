// The model key (`llm`: the TEF_NOTES_PROVIDER's, models.ts) and the search key (`exa`): each directory is mounted read-only at /run/<name>/ (docker-compose.yml;
// TEF_NOTES_KEYS_DIR moves /run) and read on every use, so a new key needs no restart. No key: the agent, or its web
// search, is unavailable. Never logged.

export type KeyName = "llm" | "exa";

const DIR = process.env.TEF_NOTES_KEYS_DIR ?? "/run";

export async function key(name: KeyName): Promise<string | undefined> {
  try {
    return (await Bun.file(`${DIR}/${name}/api-key`).text()).trim() || undefined;
  } catch {
    return undefined;
  }
}
