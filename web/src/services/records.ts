// The shared collection protocol uses the web's existing axios pipeline. Keep native
// AxiosErrors, network reporting and the sync engine's offline exemption.
import { AxiosError } from "axios";
import type { RecordTransport } from "@/core/record-protocol";
import { api, synced } from "./api";

export const recordTransport: RecordTransport = {
  async request(path, request = {}) {
    const { data } = await api.request({
      url: path, method: request.method ?? "GET", data: request.body,
      ...(request.timeout === undefined ? {} : { timeout: request.timeout }), ...synced,
    });
    return data;
  },
  status: (e) => e instanceof AxiosError ? e.response?.status : undefined,
};
