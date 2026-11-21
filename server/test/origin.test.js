// lib/origin.js: which browser requests origin.pb.js refuses.
import { describe, expect, test } from "bun:test";
import lib from "../pb_hooks/lib/origin.js";

const { refusal, servedExtension } = lib;
const ID = "abcdefghijklmnopabcdefghijklmnop";
const at = (r) => ({ method: "POST", path: "/api/collections/notes/records", host: "notes.example.net", ...r });

describe("refusal", () => {
  test("a page on another site can't write, whatever it sends", () => {
    for (const r of [
      { site: "cross-site", origin: "https://evil.example" },
      { site: "same-site", origin: "https://other.example.net" },          // another service on the same site
      { site: "cross-site", origin: "null" },
      { site: "cross-site" },                                            // a form or no-cors POST without an Origin
      { origin: "https://evil.example" },                                // a browser without Fetch Metadata
      { origin: "null" },
      { method: "PATCH", site: "cross-site", origin: "https://evil.example" },
      { method: "DELETE", site: "cross-site", origin: "https://evil.example" },
    ]) expect(refusal(at(r), "")).toBe("Requests from other sites are refused.");
  });
  test("nor make the server fetch for it", () => {
    for (const path of lib.FETCHERS) {
      expect(refusal(at({ method: "GET", path, site: "cross-site", mode: "no-cors" }), "")).not.toBeNull();
      expect(refusal(at({ method: "GET", path, site: "cross-site", origin: "https://evil.example", mode: "cors" }), "")).not.toBeNull();
    }
  });
  test("the web app, an older browser on this host, and anything not a browser go ahead", () => {
    for (const r of [
      { site: "same-origin", origin: "https://notes.example.net" },
      { site: "none" },
      { origin: "https://notes.example.net" },
      { origin: "https://notes.example.net:8443", host: "127.0.0.1:8090", forwardedHost: "notes.example.net:8443" },
      {},                                                                // CLI, agent, Android companion
    ]) expect(refusal(at(r), "")).toBeNull();
  });
  test("reads other than the fetchers are CORS's to govern", () => {
    expect(refusal(at({ method: "GET", path: "/api/collections/notes/records", site: "cross-site", origin: "https://evil.example" }), "")).toBeNull();
    expect(refusal(at({ method: "OPTIONS", site: "cross-site", origin: "https://evil.example" }), "")).toBeNull();
  });
  test("the extension: the served one alone, or any when the server serves none", () => {
    const ext = (id, r = {}) => at({ site: "cross-site", origin: `chrome-extension://${id}`, ...r });
    expect(refusal(ext(ID), ID)).toBeNull();
    expect(refusal(ext("pppppppppppppppppppppppppppppppp"), ID)).toBe("Only this server's extension may write to it.");
    expect(refusal(ext("pppppppppppppppppppppppppppppppp"), "")).toBeNull();
    // a GET with the host permission: cors mode, no Origin, which a page's cross-site request never is
    expect(refusal(at({ method: "GET", path: "/api/tefnotes/clip/image", site: "cross-site", mode: "cors" }), ID)).toBeNull();
  });
});

describe("servedExtension", () => {
  test("the id in update.xml, or none", () => {
    expect(servedExtension(`<gupdate>\n  <app appid="${ID}">\n    <updatecheck codebase="x" version="1" />\n  </app>\n</gupdate>`)).toBe(ID);
    expect(servedExtension("")).toBe("");
    expect(servedExtension('<app appid="not-an-id">')).toBe("");
  });
});
