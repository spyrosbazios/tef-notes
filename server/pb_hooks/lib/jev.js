// JEV, TypeSafe's decision model, through its System One API (https://docs.typesafe.ai): what the hooks that ask it
// (autotag.pb.js, clip.pb.js) share. It answers typed questions about a state (noul: a probability; choice: one of the
// options given, with every option's probability); it writes no text. It reads images too (the clip route sends one, the auto-tagger up to three).
//
// The key is the `typesafe` one (lib/keys.js). TEF_NOTES_JEV_URL and TEF_NOTES_JEV_MODEL override the endpoint and the model.

const { env } = require("./env.js");

const URL = env("TEF_NOTES_JEV_URL") || "https://api.typesafe.ai/v1/systemone";
const MODEL = env("TEF_NOTES_JEV_MODEL") || "jev-1.13.0";   // pinned, so the thresholds do not drift with jev-latest

/** The `$http.send` options for one request. A body with `assets` carries images, which TypeSafe takes only with its
 *  opt-in header (https://docs.typesafe.ai/images.md: base64 PNG or JPEG, each side 280 to 1568 px). */
const request = (key, body, timeout = 30) => ({
  url: URL, method: "POST", timeout, body: JSON.stringify(body),
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, ...(body.assets ? { "TypeSafe-Danger-Zone-Images": "true" } : {}) },
});

/** A status that says asking again soon is no use: the key, credits, the rate limit, an outage. */
const down = (status) => status === 401 || status === 402 || status === 429 || status >= 500;

module.exports = { URL, MODEL, request, down };
