import { describe, expect, it } from "bun:test";
import { deviceLabel, endpointOf, payloadOf, serverKeyOf, subscriptionOf, taskUrl } from "../src/push";

const keys = { p256dh: "BL7ELU24fJTAlH5Kyl8N6BDCac8u8li_U5PIwG963MOvdYs9s7LSzj8x_7v7RFdLZ9Eap50PiiyF5K0TDAis7t0", auth: "juarI8x__VnHvsOgfeAPHg" };
const endpoint = "https://fcm.googleapis.com/fcm/send/d61c5u920dw:APA91bEmnw8";

describe("endpointOf", () => {
  it("takes an https push service and nothing the agent should not post to", () => {
    expect(endpointOf(endpoint)).toBe(endpoint);
    for (const bad of ["http://fcm.googleapis.com/x", "https://localhost/x", "https://10.0.0.5/x", "https://[::1]/x", "https://nas/x", "https://a.internal/x", "https://u:p@fcm.googleapis.com/x", "not a url", "", 5, null])
      expect(endpointOf(bad)).toBe("");
    expect(endpointOf(`https://fcm.googleapis.com/${"a".repeat(2100)}`)).toBe("");
  });
});

describe("subscriptionOf", () => {
  it("reads a PushSubscription's JSON and a label, trimmed and bounded", () => {
    expect(subscriptionOf({ endpoint, expirationTime: null, keys, label: "  Laptop  " })).toEqual({ endpoint, keys, label: "Laptop" });
    expect(subscriptionOf({ endpoint, keys })?.label).toBe("");
    expect(subscriptionOf({ endpoint, keys, label: "x".repeat(200) })?.label).toHaveLength(80);
  });
  it("refuses what a browser could not have made", () => {
    expect(subscriptionOf(null)).toBeNull();
    expect(subscriptionOf({ endpoint })).toBeNull();
    expect(subscriptionOf({ endpoint, keys: { p256dh: keys.p256dh } })).toBeNull();
    expect(subscriptionOf({ endpoint, keys: { p256dh: "short", auth: keys.auth } })).toBeNull();
    expect(subscriptionOf({ endpoint: "http://x.example/p", keys })).toBeNull();
    expect(subscriptionOf({ endpoint, keys: { p256dh: 1, auth: 2 } })).toBeNull();
  });
});

describe("payloadOf", () => {
  it("reads a reminder, filling the url and tag", () => {
    expect(payloadOf({ title: "Call", body: "09:00", task: "abc" })).toEqual({ title: "Call", body: "09:00", task: "abc", url: taskUrl("abc"), tag: "task:abc" });
    expect(payloadOf({ title: "Call", task: "abc", url: "/x", tag: "t" })).toMatchObject({ url: "/x", tag: "t", body: "" });
  });
  it("keeps only a path on the app's origin as the url", () => {
    for (const url of ["https://evil.example/x", "//evil.example/x", "/\\evil.example", "javascript:alert(1)", "today"])
      expect(payloadOf({ title: "Call", task: "abc", url })?.url).toBe(taskUrl("abc"));
  });
  it("is null for anything else", () => {
    expect(payloadOf(null)).toBeNull();
    expect(payloadOf({ title: "x" })).toBeNull();
    expect(payloadOf("hi")).toBeNull();
  });
});

describe("serverKeyOf", () => {
  it("turns the VAPID key's URL-safe base64 into its bytes, padded or not", () => {
    const key = "BL7ELU24fJTAlH5Kyl8N6BDCac8u8li_U5PIwG963MOvdYs9s7LSzj8x_7v7RFdLZ9Eap50PiiyF5K0TDAis7t0";
    const bytes = serverKeyOf(key);
    expect(bytes).toHaveLength(65);
    expect(bytes![0]).toBe(4);                                         // an uncompressed P-256 point
    expect(Buffer.from(bytes!).toString("base64url")).toBe(key);
    expect(serverKeyOf(`${key}=`)).toEqual(bytes);
    expect(serverKeyOf("_-8")).toEqual(new Uint8Array([0xff, 0xef]));
  });
  it("refuses what is not base64url", () => {
    for (const bad of ["", "a+b/", "not base64!", "a"]) expect(serverKeyOf(bad)).toBeNull();
  });
});

describe("deviceLabel", () => {
  it("names the browser and the system", () => {
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36")).toBe("Chrome on Android");
    expect(deviceLabel("Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0")).toBe("Firefox on Linux");
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0")).toBe("Edge on Windows");
    expect(deviceLabel("")).toBe("Browser");
  });
});
