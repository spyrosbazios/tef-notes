// Search by asking (contract: core/find.ts): the agent looks through the notes and tasks for what an empty search meant.
import { FIND_PATH, foundOf, type Found } from "@/core/find";
import { api } from "./api";

export const findByAsking = async (q: string, signal: AbortSignal): Promise<Found> =>
  foundOf((await api.post(`/agent/${FIND_PATH}`, { q }, { baseURL: "", timeout: 90_000, signal })).data);
