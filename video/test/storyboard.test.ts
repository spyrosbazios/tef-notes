// The storyboard is edited on every release, by an agent (.claude/skills/promo-video/SKILL.md): these hold it to its
// rules, so a cut that breaks one fails before anything is rendered.
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { CLOSING, FPS, frames, OPENING, POSTER, RULES, STORYBOARD, timeline } from "../src/storyboard";

const here = (p: string) => new URL(p, import.meta.url);
const words = (s: string) => s.trim().split(/\s+/).length;

test("the film runs no longer than its budget", () => {
  const total = OPENING.seconds + CLOSING.seconds + STORYBOARD.reduce((sum, s) => sum + s.seconds, 0);
  expect(total).toBeLessThanOrEqual(RULES.seconds);
  const last = timeline().at(-1)!;
  expect(last.start + last.seconds).toBe(total);
});

test("every length is a whole number of frames", () => {
  for (const s of timeline()) expect(Number.isInteger(s.seconds * FPS)).toBe(true);
  expect(frames(1)).toBe(FPS);
});

test("the pinned scenes are all there, and the rotating ones no more than their slots", () => {
  expect(STORYBOARD.filter((s) => s.slot === "pinned")).toHaveLength(RULES.pinned);
  expect(STORYBOARD.filter((s) => s.slot === "rotating").length).toBeLessThanOrEqual(RULES.rotating);
});

test("a scene plays once, and has its file", () => {
  const names = STORYBOARD.map((s) => s.scene);
  expect(new Set(names).size).toBe(names.length);
  for (const name of [...names, "Opening", "Closing"]) expect(existsSync(here(`../src/scenes/${name}.tsx`))).toBe(true);
});

test("a scene is long enough to read and short enough to show one thing", () => {
  for (const s of STORYBOARD) {
    expect(s.seconds).toBeGreaterThanOrEqual(RULES.scene.min);
    expect(s.seconds).toBeLessThanOrEqual(RULES.scene.max);
  }
});

test("the words are short", () => {
  for (const s of STORYBOARD) {
    expect(words(s.caption)).toBeLessThanOrEqual(RULES.captionWords);
    expect(words(s.eyebrow)).toBeLessThanOrEqual(RULES.eyebrowWords);
    expect(s.why.trim().length).toBeGreaterThan(0);
  }
});

test("a scene's `since` is a release in the changelog", () => {
  const released = new Set([...readFileSync(here("../../CHANGELOG.md"), "utf8").matchAll(/^## (\d+\.\d+\.\d+) /gm)].map((m) => m[1]));
  for (const s of STORYBOARD) expect(released.has(s.since)).toBe(true);
});

test("the poster is a moment of a scene that plays", () => {
  expect(STORYBOARD.some((s) => s.scene === POSTER.scene)).toBe(true);
  expect(POSTER.at).toBeGreaterThan(0);
  expect(POSTER.at).toBeLessThan(1);
});

test("the packages the film shares with the site are asked for in the same versions", () => {
  // The film draws the site's screens with its own copies of these (bundler.ts): a different range would draw them differently.
  const deps = (path: string) => { const p = JSON.parse(readFileSync(here(path), "utf8")); return { ...p.dependencies, ...p.devDependencies }; };
  const site = deps("../../site/package.json"), film = deps("../package.json");
  for (const name of ["react", "react-dom", "lucide-react", "tailwindcss"]) expect(film[name]).toBe(site[name]);
});
