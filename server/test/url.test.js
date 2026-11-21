// lib/url.js, the one piece of the hooks' bundle that is not the clients' own code: the `URL` goja lacks, as much of it as
// the bundle reads (a host of an http(s) link). Held to the platform's URL over generated addresses with a host.
import { describe, expect, test } from "bun:test";
import { URL as Small } from "../pb_hooks/lib/url.js";

/** A seeded generator, so a failure names an address that fails again. */
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

const pick = (r, xs) => xs[Math.floor(r() * xs.length)];
const SCHEMES = ["http", "https", "HTTPS", "ftp", "ws", "wss", "1http", "ht tp", ""];
const SEPS = ["://", ":", ":/", ":\\\\", ":///", "://\t"];
const USERS = ["", "user@", "user:pw@", "a@b@", "@"];
const HOSTS = ["example.com", "WWW.Example.ORG", "a.b.c", "localhost", "127.0.0.1", "[::1]", "sub-domain.x", "", "ex ample.com", "www.", "xn--bcher-kva.example"];
const PORTS = ["", ":80", ":8080", ":", ":99999", ":x"];
const PATHS = ["", "/", "/a?b=1", "/a#frag", "?q", "#h", "/a/b%20c.png", "\\path", "/(x)"];
const PADS = ["", " ", "\n", "\t", "\u0000"];

/** What the platform's URL gives as the host, or "throws". */
const real = (u) => { try { return new URL(u).hostname; } catch { return "throws"; } };
const small = (u) => { try { return new Small(u).hostname; } catch { return "throws"; } };

describe("lib/url.js", () => {
  test("the host the platform's URL gives, or a throw where it throws, over generated ASCII addresses", () => {
    const r = rng(20261121);
    for (let i = 0; i < 20000; i++) {
      const u = pick(r, PADS) + pick(r, SCHEMES) + pick(r, SEPS) + pick(r, USERS) + pick(r, HOSTS) + pick(r, PORTS) + pick(r, PATHS) + pick(r, PADS);
      const want = real(u);
      expect([u, small(u)]).toEqual([u, want]);
    }
  });
  test("the addresses a clip carries", () => {
    for (const u of ["https://www.example.com/a?b=1", "https://user@WWW.Example.org:8080/x", "http://[::1]:80/x", "https://", "notaurl", "https://a b.com/"]) {
      expect([u, small(u)]).toEqual([u, real(u)]);
    }
  });
});
