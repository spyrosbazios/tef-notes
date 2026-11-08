// Search by asking (contract: core/find.ts): the agent looks through the notes and tasks for what an empty search meant.
import { HttpError, getJson } from "@/core/http";
import { FIND_PATH, foundOf, type Found } from "@/core/find";
import { agentUrl } from "@/core/pocketbase";

/** The server's reason when it gave one, else that it didn't answer. */
export const findError = (e: unknown) => (e instanceof HttpError && typeof e.body?.message === "string" ? e.body.message : "Couldn't reach the notes server.");

export async function findByAsking(server: string, q: string, signal: AbortSignal): Promise<Found> {
  const init = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ q }), signal };
  return foundOf(await getJson(agentUrl({ url: server }, FIND_PATH), init, 1, 90_000));
}
