// What the auto-tagger (and anyone sending JEV a stored photo) needs to know about an image's bytes, apart from
// PocketBase so it can be tested under bun (test/images.test.js): which photos a note's body embeds, the size and kind
// a file's header says, whether TypeSafe takes it (https://docs.typesafe.ai/images.md: PNG or JPEG, each side 280 to
// 1568 px, 78,400 to 2,458,624 pixels in all, anything else rejects the whole request and is never resized), and its
// base64. The JSVM has no `btoa` and no image decoder, so both are done here on the bytes; `bytes` is anything
// indexable with a length (a Uint8Array under bun, the Go slice `toBytes` returns in a hook).

const MIN_SIDE = 280;
const MAX_SIDE = 1568;
const MIN_PIXELS = 78400;
const MAX_PIXELS = 2458624;
const MAX_BYTES = 8 * 1024 * 1024;      // of a file read: the phone's photos are a few hundred KB, an upload may be 15 MB

/** The attachments a note's body embeds as pictures (`![caption](../attachments/<note-id>/<name>)`), in body order,
 *  each once, as `{name, caption}`. Only JPEG and PNG names: a PDF is a plain link, and WebP and GIF are not taken. */
function embedded(body, noteId) {
  const out = [], re = /!\[([^\]]*)\]\(\.\.\/attachments\/([^/)\s]+)\/([^)\s]+)\)/g;
  let m;
  while ((m = re.exec(body))) {
    if (m[2] !== noteId || !/\.(jpe?g|png)$/i.test(m[3]) || out.some((p) => p.name === m[3])) continue;
    out.push({ name: m[3], caption: m[1].trim() });
  }
  return out;
}

const u32 = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const tag = (b, i) => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);

function png(b) {
  if (b.length < 24 || tag(b, 12) !== "IHDR") return null;
  // An animated PNG is rejected: its `acTL` chunk comes before the first `IDAT`
  for (let i = 8; i + 8 <= b.length;) {
    const t = tag(b, i + 4);
    if (t === "acTL") return null;
    if (t === "IDAT") break;
    i += 12 + u32(b, i);
  }
  return { format: "png", width: u32(b, 16), height: u32(b, 20) };
}

function jpeg(b) {
  for (let i = 2; i + 4 <= b.length;) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1];
    if (m === 0xff) { i++; continue; }                                    // fill byte
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd9)) { i += 2; continue; }     // markers with no length
    const len = (b[i + 2] << 8) | b[i + 3];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {   // a start-of-frame: height, then width
      if (i + 9 > b.length) return null;
      return { format: "jpg", width: (b[i + 7] << 8) | b[i + 8], height: (b[i + 5] << 8) | b[i + 6] };
    }
    if (m === 0xda) return null;                                          // the scan began with no frame header
    i += 2 + len;
  }
  return null;
}

/** `{format: "jpg" | "png", width, height}` from a file's header, or null when it is neither (or is animated, or cut short). */
function info(b) {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return jpeg(b);
  if (b.length > 7 && b[0] === 0x89 && tag(b, 1) === "PNG\r" && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return png(b);
  return null;
}

/** Whether TypeSafe takes an image this size. */
const fits = (w, h) => w >= MIN_SIDE && h >= MIN_SIDE && w <= MAX_SIDE && h <= MAX_SIDE && w * h >= MIN_PIXELS && w * h <= MAX_PIXELS;

/** Whether an image this size is only too big: shrunk to fit inside MAX_SIDE square it could be taken. */
const shrinkable = (w, h) => w > 0 && h > 0 && (w > MAX_SIDE || h > MAX_SIDE) && fits(...scaled(w, h));

/** The size `fit inside MAX_SIDE x MAX_SIDE` leaves (never enlarging), as PocketBase's thumb "1568x1568f" rounds it. */
function scaled(w, h) {
  const k = Math.min(1, MAX_SIDE / w, MAX_SIDE / h);
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Standard base64, padded. */
function base64(b) {
  const parts = [];
  let s = "";
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((i + 1 < b.length ? b[i + 1] : 0) << 8) | (i + 2 < b.length ? b[i + 2] : 0);
    s += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63] + (i + 1 < b.length ? ALPHABET[(n >> 6) & 63] : "=") + (i + 2 < b.length ? ALPHABET[n & 63] : "=");
    if (s.length >= 8192) { parts.push(s); s = ""; }
  }
  parts.push(s);
  return parts.join("");
}

const bytesOf = (fsys, key) => {
  const r = fsys.getReader(key);
  try { return toBytes(r, MAX_BYTES); } finally { r.close(); }
};

/** One stored attachment as TypeSafe takes it, `{format, data}` (base64), or null when it can't be read or doesn't fit
 *  (one too big is shrunk with PocketBase's own thumbnailer through a temporary file, deleted at once). Only in a hook's
 *  VM: `fsys` is `$app.newFilesystem()`, `att` an `attachments` record, and `toBytes` is PocketBase's. */
function lookOf(fsys, att) {
  const key = `${att.baseFilesPath()}/${att.getString("file")}`;
  let thumb = "";
  try {
    let bytes = bytesOf(fsys, key), meta = info(bytes);
    if (meta && !fits(meta.width, meta.height) && shrinkable(meta.width, meta.height)) {
      thumb = `${att.baseFilesPath()}/thumbs_${att.getString("file")}/look_${MAX_SIDE}`;
      fsys.createThumb(key, thumb, `${MAX_SIDE}x${MAX_SIDE}f`);
      bytes = bytesOf(fsys, thumb);
      meta = info(bytes);
    }
    if (!meta || !fits(meta.width, meta.height)) return null;
    return { format: meta.format, data: base64(bytes) };
  } finally {
    if (thumb) { try { fsys.delete(thumb); } catch (_) { /* never written */ } }
  }
}

/** What a stored attachment's header says it is, `{format, width, height}` (JPEG or PNG), or null for any other bytes. Only in
 *  a hook's VM, as lookOf. */
function describe(fsys, att) {
  return info(bytesOf(fsys, `${att.baseFilesPath()}/${att.getString("file")}`));
}

module.exports = { describe, lookOf, MIN_SIDE, MAX_SIDE, MIN_PIXELS, MAX_PIXELS, MAX_BYTES, embedded, info, fits, shrinkable, scaled, base64 };
