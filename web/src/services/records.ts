// The shared collection protocols (core/record-protocol.ts, core/prefs-sync.ts) over the web's axios pipeline: its interceptors'
// network reporting and Conflict, and whether a write waits for the network. The protocol reads a failure's answer here and fails
// with its typed outcome; a request nothing answered fails here already, as Unavailable in words for a toast.
import { AxiosError } from "axios";
import { Unavailable } from "@/core/record-contracts";
import type { RecordTransport } from "@/core/record-protocol";
import { api, synced } from "./api";

const transportOf = (sync: boolean): RecordTransport => ({
  async request(path, request = {}) {
    try {
      const { data } = await api.request({
        url: path, method: request.method ?? "GET", data: request.body, signal: request.signal,
        ...(request.timeout === undefined ? {} : { timeout: request.timeout }), ...(sync ? synced : {}),
      });
      return data;
    } catch (e) {
      if (e instanceof AxiosError && !e.response && e.code !== AxiosError.ERR_CANCELED) throw new Unavailable("The server can't be reached.");
      throw e;
    }
  },
  answer: (e) => e instanceof AxiosError && e.response ? { status: e.response.status, body: e.response.data } : undefined,
});

/** The sync engine's and the preferences engine's: an edit waits in their copy, so these go out whatever the browser says
 *  (api.ts `synced`). */
export const recordTransport = transportOf(true);
/** Every other collection's (lenses, tags, attachments, chats): nothing to wait in, so a write is refused up front while the
 *  browser is offline (api.ts `Offline`). */
export const directTransport = transportOf(false);
