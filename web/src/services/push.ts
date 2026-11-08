// Web Push on the agent (core/push.ts has the contract): the key the browser subscribes with, and the subscription it hands
// over so the server can send task reminders to this device. Under /agent, like the models route.
import type { PushKey, PushSubscribeBody } from "@/core/push";
import { api, orNull } from "./api";

/** The server's VAPID public key (URL-safe base64); null when the server has push off (the route is a 404). */
export async function key(): Promise<string | null> {
  const r = await orNull(api.get<PushKey>("/agent/push/key", { baseURL: "" }));
  return r?.data.publicKey ?? null;
}

/** This device's subscription, saved on the server; the same endpoint again replaces it. */
export async function subscribe(body: PushSubscribeBody): Promise<void> {
  await api.post("/agent/push/subscribe", body, { baseURL: "" });
}

/** The subscription for `endpoint` removed from the server; one it never had is done. */
export async function unsubscribe(endpoint: string): Promise<void> {
  await api.delete("/agent/push/subscribe", { baseURL: "", data: { endpoint } });
}
