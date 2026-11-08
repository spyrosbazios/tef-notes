// The link-preview lib (pb_hooks/lib/link-preview.js): what it refuses to fetch, how it follows a redirect, what it
// reads out of a page. The network is a stub: `get` answers with canned curl output.
import { describe, expect, test } from "bun:test";
import lib from "../pb_hooks/lib/link-preview.js";

const { isPublicIp, parseUrl, resolveUrl, fetchPage, parsePage, pageText, textOf, htmlOf, previewOf, Blocked } = lib;

describe("addresses", () => {
  test("public ones pass", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:10::6814:179a", "::ffff:8.8.8.8", "64:ff9b::808:808"]) expect(isPublicIp(ip)).toBe(true);
  });
  test("loopback, private, link-local, CGNAT (tailnet) and reserved ones do not", () => {
    for (const ip of [
      "0.0.0.0", "127.0.0.1", "127.1.2.3", "10.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1",
      "100.64.0.1", "100.127.255.255", "224.0.0.1", "255.255.255.255", "198.18.0.1", "::", "::1", "fe80::1", "fc00::1",
      "fd7a:115c:a1e0::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:192.168.0.1", "64:ff9b::7f00:1", "2001:db8::1",
      "2002:7f00:1::", "not an ip", "1.2.3", "01.2.3.4", "300.1.1.1",
    ]) expect([ip, isPublicIp(ip)]).toEqual([ip, false]);
  });
  test("just outside the private ranges is public", () => {
    for (const ip of ["100.63.255.255", "100.128.0.1", "172.15.255.255", "172.32.0.1", "11.0.0.1"]) expect([ip, isPublicIp(ip)]).toEqual([ip, true]);
  });
});

describe("parseUrl", () => {
  test("normalises", () => {
    expect(parseUrl("HTTPS://Example.COM/a/b?x=1#frag").href).toBe("https://example.com/a/b?x=1");
    expect(parseUrl("http://example.com").href).toBe("http://example.com/");
    expect(parseUrl("http://example.com:8080/x").port).toBe(8080);
    expect(parseUrl("https://example.com./x").host).toBe("example.com");
    expect(parseUrl("https://[2606:4700:10::6814:179a]/").bracket).toBe(true);
  });
  test("refuses what is not a public web address", () => {
    for (const u of [
      "ftp://example.com/", "file:///etc/passwd", "javascript:alert(1)", "//example.com", "example.com", "http://", "http://user:pw@example.com/",
      "http://localhost/", "http://localhost:8097/", "http://127.0.0.1/", "http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://10.1.2.3/",
      "http://169.254.169.254/latest/meta-data", "http://100.64.0.1:8097/", "http://myhost/", "http://host.example.ts.net/",
      "http://nas.local/", "http://router.lan/", "http://2130706433/", "http://0x7f.1/", "http://0177.0.0.1/", "http://127.1/",
      "http://example.com:0/", "http://example.com:99999/", "http://exa mple.com/", "http://a.b.c.1/",
    ]) expect([u, (() => { try { parseUrl(u); return "allowed"; } catch (e) { return e instanceof Blocked ? "blocked" : String(e); } })()]).toEqual([u, "blocked"]);
  });
});

describe("resolveUrl", () => {
  const base = "https://example.com/a/b/page.html?q=1";
  test("the forms pages use", () => {
    expect(resolveUrl(base, "https://other.org/x")).toBe("https://other.org/x");
    expect(resolveUrl(base, "//cdn.org/i.png")).toBe("https://cdn.org/i.png");
    expect(resolveUrl(base, "/i.png")).toBe("https://example.com/i.png");
    expect(resolveUrl(base, "i.png")).toBe("https://example.com/a/b/i.png");
    expect(resolveUrl(base, "../i.png")).toBe("https://example.com/a/i.png");
    expect(resolveUrl(base, "../../../../i.png")).toBe("https://example.com/i.png");
    expect(resolveUrl(base, "?p=2")).toBe("https://example.com/a/b/page.html?p=2");
    expect(resolveUrl("https://example.com", "x")).toBe("https://example.com/x");
  });
});

const reply = (status, headers, body = "") =>
  `HTTP/2 ${status}\r\n${Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join("\r\n")}\r\n\r\n${body}`;

/** A stub network: `pages` by href, `dns` by name. Records what curl was asked for. */
function net(pages, dns = {}) {
  const asked = [];
  return {
    asked,
    lookup: (h) => dns[h] ?? ["93.184.216.34"],
    get: (args) => {
      asked.push(args);
      const href = args[args.length - 1];
      if (!(href in pages)) throw new Error("no answer");
      return pages[href];
    },
  };
}

describe("fetchPage", () => {
  test("follows redirects, checking each hop", () => {
    const io = net({
      "https://a.example.org/": reply(301, { location: "https://b.example.org/next" }),
      "https://b.example.org/next": reply(302, { Location: "/final" }),
      "https://b.example.org/final": reply(200, { "content-type": "text/html; charset=utf-8" }, "<title>Hi</title>"),
    });
    const p = fetchPage("https://a.example.org/", io);
    expect(p).toMatchObject({ url: "https://b.example.org/final", status: 200 });
    expect(io.asked.length).toBe(3);
  });
  test("pins the address it checked", () => {
    const io = net({ "https://a.example.org/x": reply(200, {}) }, { "a.example.org": ["2606:4700::1", "93.184.216.34"] });
    fetchPage("https://a.example.org/x", io);
    expect(io.asked[0]).toEqual(["--resolve", "a.example.org:443:93.184.216.34", "--", "https://a.example.org/x"]);
  });
  test("a redirect to a private address is refused, however it is spelled", () => {
    for (const to of ["http://127.0.0.1:8097/", "http://[::1]/", "http://192.168.1.1/admin", "http://localhost/", "http://myhost/", "file:///etc/passwd", "http://2130706433/"]) {
      const io = net({ "https://a.example.org/": reply(302, { location: to }) });
      expect(() => fetchPage("https://a.example.org/", io)).toThrow(Blocked);
      expect(io.asked.length).toBe(1);
    }
  });
  test("a name that resolves to a private address is refused before any connection", () => {
    for (const ips of [["127.0.0.1"], ["93.184.216.34", "10.0.0.5"], ["fd7a:115c:a1e0::1"], ["100.64.0.1"]]) {
      const io = net({}, { "evil.example.org": ips });
      expect(() => fetchPage("https://evil.example.org/", io)).toThrow(Blocked);
      expect(io.asked.length).toBe(0);
    }
  });
  test("an unresolvable name is an error, not a block", () => {
    const io = net({}, { "nope.example.org": [] });
    expect(() => fetchPage("https://nope.example.org/", io)).toThrow("does not resolve");
  });
  test("caps the redirects", () => {
    const pages = {};
    for (let i = 0; i < 10; i++) pages[`https://a.example.org/${i}`] = reply(302, { location: `/${i + 1}` });
    expect(() => fetchPage("https://a.example.org/0", net(pages))).toThrow("too many redirects");
  });
  test("gives up when the budget is spent", () => {
    let t = 0;
    const io = net({ "https://a.example.org/": reply(200, {}) });
    expect(() => fetchPage("https://a.example.org/", io, () => (t += 20000))).toThrow("took too long");
  });
});

const PAGE = `<!doctype html><html><head>
<meta charset="utf-8">
<title>Plain &amp; simple</title>
<meta name="description" content="The plain description">
<meta property="og:title" content="The &quot;OG&quot; title">
<meta content="An OG description with &#x3b1;" property='og:description'>
<meta property="og:site_name" content="Example Site">
<meta property="og:image" content="/img/cover.png">
<meta property="og:image" content="/second.png">
<link rel="shortcut icon" href="favicon-32.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple.png">
<script>var s = '<meta property="og:title" content="from a script">';</script>
</head><body><meta property="og:title" content="in the body"><h1>x</h1></body></html>`;

describe("parsePage", () => {
  test("reads OpenGraph first and resolves its addresses", () => {
    expect(parsePage(PAGE, "http://www.example.com/a/page")).toEqual({
      title: 'The "OG" title', description: "An OG description with α", site: "Example Site",
      image: "https://www.example.com/img/cover.png", icon: "https://www.example.com/a/favicon-32.png",
    });
  });
  test("falls back to the plain tags, the host and /favicon.ico", () => {
    expect(parsePage("<html><head><title> Just\n a title </title><meta name=description content=\"d\"></head></html>", "https://www.example.com/x")).toEqual({
      title: "Just a title", description: "d", site: "example.com", image: "", icon: "https://www.example.com/favicon.ico",
    });
  });
  test("takes twitter cards, and the apple icon when there is no other", () => {
    const p = parsePage('<head><meta name="twitter:title" content="T"><meta name="twitter:image" content="http://cdn.example.com/a.jpg"><link rel="apple-touch-icon" href="/a.png"></head>', "https://example.com/");
    expect(p).toMatchObject({ title: "T", image: "https://cdn.example.com/a.jpg", icon: "https://example.com/a.png" });
  });
  test("does not hand clients a picture on a private address", () => {
    const p = parsePage('<head><meta property="og:image" content="http://192.168.1.5/x.png"><meta property="og:title" content="T"></head>', "https://example.com/");
    expect(p.image).toBe("");
  });
  test("is not thrown by junk", () => {
    expect(() => parsePage("", "https://example.com/")).not.toThrow();
    expect(() => parsePage("<meta <title><<>>=\"'", "https://example.com/")).not.toThrow();
  });
});

describe("previewOf", () => {
  test("a page", () => {
    const io = net({ "https://example.com/": reply(200, { "content-type": "text/html" }, PAGE) });
    expect(previewOf("https://example.com/", io).title).toBe('The "OG" title');
  });
  test("a link straight to a picture is that picture", () => {
    const io = net({ "https://example.com/p/cat%20photo.jpg?s=1": reply(200, { "content-type": "image/jpeg" }, "\u0000") });
    expect(previewOf("https://example.com/p/cat%20photo.jpg?s=1", io)).toMatchObject({ title: "cat photo.jpg", image: "https://example.com/p/cat%20photo.jpg?s=1" });
  });
  test("an error page or a non-page has nothing to preview", () => {
    const empty = { title: "", description: "", site: "", image: "", icon: "" };
    expect(previewOf("https://example.com/", net({ "https://example.com/": reply(404, { "content-type": "text/html" }, PAGE) }))).toEqual(empty);
    expect(() => previewOf("https://example.com/", net({ "https://example.com/": reply(429, { "content-type": "text/html" }, PAGE) }))).toThrow("429");
    expect(() => previewOf("https://example.com/", net({ "https://example.com/": reply(503, { "content-type": "text/html" }, PAGE) }))).toThrow("503");
    expect(previewOf("https://example.com/", net({ "https://example.com/": reply(200, { "content-type": "application/pdf" }, "%PDF") }))).toEqual(empty);
  });
  const VIDEO = "https://youtu.be/abc?t=5";
  const OE = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(VIDEO)}`;
  test("a YouTube video through oEmbed, not its page", () => {
    const io = net({ [OE]: reply(200, { "content-type": "application/json" }, JSON.stringify({
      title: "A video", author_name: "A channel", provider_name: "YouTube", thumbnail_url: "https://i.ytimg.com/vi/abc/hqdefault.jpg",
    })) });
    expect(previewOf(VIDEO, io)).toEqual({
      title: "A video", description: "A channel", site: "YouTube",
      image: "https://i.ytimg.com/vi/abc/hqdefault.jpg", icon: "https://www.youtube.com/favicon.ico",
    });
    expect(io.asked).toHaveLength(1);
  });
  test("an oEmbed that fails falls back to the page", () => {
    const io = net({ [OE]: reply(404, {}), [VIDEO]: reply(200, { "content-type": "text/html" }, PAGE) });
    expect(previewOf(VIDEO, io).title).toBe('The "OG" title');
  });
});

describe("curlFile", () => {
  test("the body to the file, cut; only the headers come back on stdout", () => {
    let call;
    const get = lib.curlFile((...a) => { call = a; return "HTTP/1.1 200 OK\r\ncontent-type: image/png\r\n\r\n"; }, "/tmp/f");
    expect(get(["--", "https://a.example/x.png"], 9)).toContain("image/png");
    const [sh, flag, script, name, file, ...args] = call;
    expect([sh, flag, name, file, args]).toEqual(["sh", "-c", "sh", "/tmp/f", ["--", "https://a.example/x.png"]]);
    expect(script).toContain("--max-redirs 0");
    expect(script).toContain(`head -c ${lib.IMAGE_BYTES} > "$f"`);
    expect(script).toContain("--max-time 9");
  });
});

describe("pageText", () => {
  const html = (body) => `<!doctype html><html><head><title>T</title><style>p { color: red }</style><script>var x = "<p>in a script</p>";</script></head><body>${body}</body></html>`;
  test("blocks on their own lines; scripts, styles, menus, footers and comments left out; entities decoded", () => {
    const text = pageText(html("<nav><a>Home</a><a>About</a></nav><h1>Title &amp; more</h1><p>First   paragraph<br>second line</p><!-- <p>hidden</p> --><ul><li>one</li><li>two</li></ul><footer>Copyright</footer>"));
    expect(text).toBe("Title & more\nFirst paragraph\nsecond line\none\ntwo");
  });
  test("the article when it holds something, else the whole page", () => {
    const long = "A sentence of the article. ".repeat(30);
    expect(pageText(html(`<div>Sidebar words</div><article><p>${long}</p></article>`))).toBe(long.trim());
    expect(pageText(html("<div>Sidebar words</div><article><p>short</p></article>"))).toBe("Sidebar words\nshort");
  });
  test("capped, and not thrown by junk", () => {
    expect(pageText(html(`<p>${"x".repeat(100)}</p>`), 10)).toHaveLength(10);
    expect(pageText("<<<>>> <p")).toBeTypeOf("string");
    expect(pageText("")).toBe("");
  });
});

describe("textOf", () => {
  const U = "https://example.com/";
  test("a page's text; an error page, a picture or a PDF has none; plain text is itself", () => {
    expect(textOf(U, net({ [U]: reply(200, { "content-type": "text/html; charset=utf-8" }, "<body><p>Hello there</p></body>") }))).toBe("Hello there");
    expect(textOf(U, net({ [U]: reply(404, { "content-type": "text/html" }, "<body><p>Not found</p></body>") }))).toBe("");
    expect(textOf(U, net({ [U]: reply(200, { "content-type": "application/pdf" }, "%PDF") }))).toBe("");
    expect(textOf(U, net({ [U]: reply(200, { "content-type": "image/png" }, "x") }))).toBe("");
    expect(textOf(U, net({ [U]: reply(200, { "content-type": "text/plain" }, " plain words \n") }))).toBe("plain words");
  });
  test("goes through the same guard: a private address is refused", () => {
    expect(() => textOf("http://192.168.1.1/", net({}))).toThrow(Blocked);
    expect(() => textOf(U, net({ [U]: reply(302, { location: "http://127.0.0.1/x" }) }))).toThrow(Blocked);
  });
});

describe("htmlOf", () => {
  const U = "https://example.com/";
  test("a page's HTML and where it ended up; an error page or something else is none", () => {
    const io = net({ [U]: reply(302, { location: "/a" }), "https://example.com/a": reply(200, { "content-type": "text/html" }, "<p>Hi</p>") });
    expect(htmlOf(U, io)).toEqual({ url: "https://example.com/a", html: "<p>Hi</p>" });
    expect(htmlOf(U, net({ [U]: reply(404, { "content-type": "text/html" }, "<p>gone</p>") }))).toBeNull();
    expect(htmlOf(U, net({ [U]: reply(200, { "content-type": "application/pdf" }, "%PDF") }))).toBeNull();
  });
  test("goes through the same guard", () => {
    expect(() => htmlOf(U, net({ [U]: reply(302, { location: "http://10.0.0.1/" }) }))).toThrow(Blocked);
  });
});
