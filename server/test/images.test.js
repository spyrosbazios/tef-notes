// The image helpers (pb_hooks/lib/images.js): what a note's body embeds, what a file's header says, the limits at
// https://docs.typesafe.ai/images.md, and base64.
import { describe, expect, test } from "bun:test";
import images from "../pb_hooks/lib/images.js";

/** A JPEG header of this size: SOI, an APP0 segment, a fill byte, then a baseline or progressive start-of-frame. */
function jpeg(w, h, sof = 0xc0) {
  return Uint8Array.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x06, 1, 2, 3, 4,
    0xff, 0xff, 0xff, sof, 0x00, 0x0b, 8, h >> 8, h & 255, w >> 8, w & 255, 1, 1, 0x11, 0,
    0xff, 0xda,
  ]);
}

/** A PNG up to its first IDAT, with the chunks `extra` names between IHDR and it. */
function png(w, h, extra = []) {
  const u32 = (n) => [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255];
  const chunk = (t, data) => [...u32(data.length), ...[...t].map((c) => c.charCodeAt(0)), ...data, 0, 0, 0, 0];
  return Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...chunk("IHDR", [...u32(w), ...u32(h), 8, 2, 0, 0, 0]),
    ...extra.flatMap((t) => chunk(t, [0, 0, 0, 1, 0, 0, 0, 0])),
    ...chunk("IDAT", [0]),
  ]);
}

describe("embedded", () => {
  const body = [
    "Receipts", "![](../attachments/20261101-a/20261101-100000.jpg)",
    "[scan.pdf](../attachments/20261101-a/scan.pdf)",
    "![the board](../attachments/20261101-a/20261101-100100.png)",
    "![again](../attachments/20261101-a/20261101-100000.jpg)",
    "![elsewhere](../attachments/other/x.jpg)",
    "![anim](../attachments/20261101-a/spin.gif)",
    "![last](../attachments/20261101-a/20261101-100200-2.JPG)",
  ].join("\n");
  test("pictures of this note in body order, each once; PDFs, other notes', GIFs left out", () => {
    expect(images.embedded(body, "20261101-a")).toEqual([
      { name: "20261101-100000.jpg", caption: "" },
      { name: "20261101-100100.png", caption: "the board" },
      { name: "20261101-100200-2.JPG", caption: "last" },
    ]);
  });
  test("no pictures", () => expect(images.embedded("just words", "n")).toEqual([]));
});

describe("info", () => {
  test("a JPEG's size, baseline or progressive, past segments and fill bytes", () => {
    expect(images.info(jpeg(1600, 1200))).toEqual({ format: "jpg", width: 1600, height: 1200 });
    expect(images.info(jpeg(300, 5000, 0xc2))).toEqual({ format: "jpg", width: 300, height: 5000 });
  });
  test("a PNG's size", () => expect(images.info(png(640, 480))).toEqual({ format: "png", width: 640, height: 480 }));
  test("an animated PNG, a cut-short file, a GIF, nothing: no info", () => {
    expect(images.info(png(640, 480, ["acTL"]))).toBeNull();
    expect(images.info(png(640, 480, ["tEXt"]))).toEqual({ format: "png", width: 640, height: 480 });
    expect(images.info(jpeg(10, 10).slice(0, 12))).toBeNull();
    expect(images.info(png(1, 1).slice(0, 20))).toBeNull();
    expect(images.info(Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0]))).toBeNull();
    expect(images.info(new Uint8Array(0))).toBeNull();
  });
  test("a minimal real JPEG file", () => {
    const b = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64");
    expect(images.info(b)).toEqual({ format: "jpg", width: 1, height: 1 });
  });
});

describe("limits", () => {
  test("280 to 1568 a side, 78,400 to 2,458,624 pixels, both ends included", () => {
    expect(images.fits(280, 280)).toBe(true);
    expect(images.fits(1568, 1568)).toBe(true);
    expect(images.fits(1568, 280)).toBe(true);
    expect(images.fits(279, 1000)).toBe(false);
    expect(images.fits(1000, 279)).toBe(false);
    expect(images.fits(1569, 1000)).toBe(false);
    expect(images.fits(1000, 1569)).toBe(false);
  });
  test("what the phone keeps (long edge 1600) is too big, and shrinks into the limits", () => {
    expect(images.fits(1600, 1200)).toBe(false);
    expect(images.shrinkable(1600, 1200)).toBe(true);
    expect(images.scaled(1600, 1200)).toEqual([1568, 1176]);
    expect(images.scaled(1200, 1600)).toEqual([1176, 1568]);
    expect(images.scaled(800, 600)).toEqual([800, 600]);
  });
  test("shrinking cannot help a strip, a speck, or a picture that already fits", () => {
    expect(images.shrinkable(1600, 200)).toBe(false);       // 1568 x 196: under 280
    expect(images.shrinkable(4000, 100)).toBe(false);
    expect(images.shrinkable(1000, 1000)).toBe(false);      // fits: nothing to shrink
    expect(images.shrinkable(100, 100)).toBe(false);        // too small, never enlarged
    expect(images.shrinkable(0, 0)).toBe(false);
  });
});

describe("base64", () => {
  test("agrees with Buffer at every length, padding included", () => {
    for (let n = 0; n < 40; n++) {
      const b = Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) & 255);
      expect(images.base64(b)).toBe(Buffer.from(b).toString("base64"));
    }
  });
  test("a large file, every byte value", () => {
    const b = Uint8Array.from({ length: 300000 }, (_, i) => i & 255);
    expect(images.base64(b)).toBe(Buffer.from(b).toString("base64"));
  });
  test("an array-like of numbers, as a hook's toBytes gives", () => {
    expect(images.base64([104, 101, 108, 108, 111])).toBe("aGVsbG8=");
  });
});
