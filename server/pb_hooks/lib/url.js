// `URL` inside the hooks' core bundle (lib/core.js, bundle/build.ts): PocketBase's JS VM (goja) has none, and the
// bundled code reads one thing of a URL, its host (core links.ts hostOf, which titles a clip of a bare link by its site;
// a clip's url is http(s) only, lib/clip.js input). This is that much of WHATWG URL, for the schemes with a host it
// always parses (http, https, ws, wss, ftp): `hostname`, or a TypeError where URL throws. An ASCII address comes out as
// URL reads it (server/test/url.test.js checks generated ones); a non-ASCII host stays Unicode, lowercased, where URL
// would give its punycode. Any other scheme is a TypeError here: nothing in the hooks hands one over.

const SCHEMES = ["http", "https", "ws", "wss", "ftp"];
const ABSOLUTE = /^([a-z][a-z\d+.-]*):(.*)$/is;
// What a host may not hold: WHATWG's forbidden host code points (`%` too: URL percent-decodes, this refuses)
const FORBIDDEN = /[\x00-\x20#%/:<>?@[\\\]^|\x7f]/;

class URL {
  constructor(input) {
    const bad = () => new TypeError(`Invalid URL: ${input}`);
    const m = ABSOLUTE.exec(String(input).replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, "").replace(/[\t\n\r]/g, ""));
    if (!m || !SCHEMES.includes(m[1].toLowerCase())) throw bad();
    const authority = /^[/\\]*([^/\\?#]*)/.exec(m[2])[1];
    const hp = /^(\[[^\]]*\]|[^:]*)(?::(.*))?$/.exec(authority.slice(authority.lastIndexOf("@") + 1));
    if (!hp || !hp[1]) throw bad();
    if (hp[2] && !(/^\d+$/.test(hp[2]) && Number(hp[2]) <= 65535)) throw bad();
    if (hp[1][0] !== "[" && FORBIDDEN.test(hp[1])) throw bad();
    this.hostname = hp[1].toLowerCase();
  }
}

module.exports = { URL };
