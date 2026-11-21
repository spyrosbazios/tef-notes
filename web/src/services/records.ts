// The shared collection protocol over the web's axios pipeline: its interceptors' network reporting and Conflict, and the
// sync engine's offline exemption. The protocol reads a failure's answer here and fails with its typed outcome.
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
  answer: (e) => e instanceof AxiosError && e.response ? { status: e.response.status, body: e.response.data } : undefined,
};
