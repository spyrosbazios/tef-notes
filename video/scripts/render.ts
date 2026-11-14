// Renders the film from the storyboard.
//   bun scripts/render.ts film             out/film.mp4 and its still, out/film-poster.jpg
//   bun scripts/render.ts stills [Scene]   out/stills/NN-Scene-T.TTs.jpg: three moments of every scene, or every half second of the one named
// Flags: --scale=0.5 (the output's size against 1920x1080; stills default to half), --concurrency=2 (browser tabs drawing
// at once; Remotion's own default is half the cores), --theme=dawn (any theme of packages/core/src/theme.ts).
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { ensureBrowser, openBrowser, renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { override } from "../bundler";
import { FPS, POSTER, timeline } from "../src/storyboard";

const root = path.resolve(import.meta.dir, "..");
const out = path.join(root, "out");
const [what, ...rest] = process.argv.slice(2);
const flag = (name: string) => rest.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const only = rest.find((a) => !a.startsWith("--"));

if (what !== "film" && what !== "stills") {
  console.error("usage: bun scripts/render.ts film | stills [Scene] [--scale=] [--concurrency=] [--theme=]");
  process.exit(2);
}

const segments = timeline();
if (only && !segments.some((s) => s.name === only)) {
  console.error(`no scene "${only}": the film has ${segments.map((s) => s.name).join(", ")}`);
  process.exit(2);
}

/** The frame `at` (0 to 1) of the way through the segment called `name`. */
function frameOf(name: string, at: number) {
  const segment = segments.find((s) => s.name === name);
  if (!segment) throw new Error(`no scene "${name}"`);
  return Math.round((segment.start + segment.seconds * at) * FPS);
}

const inputProps = flag("theme") ? { theme: flag("theme") } : {};
const concurrency = flag("concurrency") ? Number(flag("concurrency")) : null;

await ensureBrowser();
const serveUrl = await bundle({ entryPoint: path.join(root, "src/index.ts"), webpackOverride: override(root) });
const composition = await selectComposition({ serveUrl, id: "Film", inputProps });
const browser = await openBrowser("chrome");
await mkdir(out, { recursive: true });

if (what === "film") {
  const scale = Number(flag("scale") ?? 1);
  let last = -1;
  await renderMedia({
    composition, serveUrl, inputProps, scale, concurrency, puppeteerInstance: browser,
    codec: "h264", outputLocation: path.join(out, "film.mp4"),
    onProgress: ({ progress }) => {
      const tenth = Math.floor(progress * 10);
      if (tenth > last) { last = tenth; console.log(`film ${tenth * 10}%`); }
    },
  });
  await renderStill({
    composition, serveUrl, inputProps, scale, puppeteerInstance: browser,
    frame: frameOf(POSTER.scene, POSTER.at), output: path.join(out, "film-poster.jpg"), imageFormat: "jpeg", jpegQuality: 88,
  });
  console.log(`out/film.mp4 (${(composition.durationInFrames / FPS).toFixed(1)} s) and out/film-poster.jpg`);
} else {
  const scale = Number(flag("scale") ?? 0.5);
  const dir = path.join(out, "stills");
  if (!only) await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  for (const [i, segment] of segments.entries()) {
    if (only && segment.name !== only) continue;
    // Every scene at three moments, or the one named at every half second: a move that goes wrong does so between moments.
    const moments = only ? Array.from({ length: Math.floor(segment.seconds * 2) }, (_, k) => (k + 0.5) / (segment.seconds * 2)) : [0.3, 0.6, 0.9];
    for (const at of moments) {
      const file = `${String(i).padStart(2, "0")}-${segment.name}-${(segment.seconds * at).toFixed(2)}s.jpg`;
      await renderStill({
        composition, serveUrl, inputProps, scale, puppeteerInstance: browser,
        frame: frameOf(segment.name, at), output: path.join(dir, file), imageFormat: "jpeg", jpegQuality: 85,
      });
      console.log(`out/stills/${file}`);
    }
  }
}

await browser.close({ silent: true });
// Under Bun a render script can stay open after its work is done (remotion.dev/docs/bun).
process.exit(0);
