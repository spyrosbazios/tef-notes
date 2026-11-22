// Updates from the app, over the agent's routes (contract: core/release.ts): which release the server runs, the newest
// published, the updater's progress, and asking it to update.
import { versionInfoOf, type UpdateBody, type VersionInfo } from "@/core/release";
import { api } from "./api";

export const versionInfo = async (): Promise<VersionInfo> =>
  versionInfoOf((await api.get("/agent/version", { baseURL: "", timeout: 20_000 })).data);

/** Asks the updater to move the server to `version`; the reason as an Error when it refuses (its answer is plain text). */
export async function startUpdate(version: string): Promise<void> {
  const r = await api.post("/agent/update", { version } satisfies UpdateBody, { baseURL: "", responseType: "text", validateStatus: () => true });
  if (r.status >= 300) throw new Error(typeof r.data === "string" && r.data ? r.data : `HTTP ${r.status}`);
}
