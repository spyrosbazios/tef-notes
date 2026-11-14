// The film's script, as data. This is the file a release edits (.claude/skills/promo-video/SKILL.md): which scenes play,
// in what order, for how long, under which words. Everything else draws what it says, and test/storyboard.test.ts holds it
// to RULES. A scene is a file in scenes/, named in scenes/index.ts; a shot is one scene's place in the film.
import type { SceneName } from "./scenes";

export const FPS = 30;
export const SIZE = { width: 1920, height: 1080 } as const;

/** What the film is cut to. A new feature takes a slot from another scene; it never makes the film longer. */
export const RULES = {
  /** The whole film, the opening and the closing included, runs no longer than this. */
  seconds: 45,
  /** The scenes that stay from release to release: what the app is. */
  pinned: 6,
  /** The scenes for what is newer: at most this many, the weakest out when a stronger one arrives. */
  rotating: 2,
  /** One scene shows one thing, in this many seconds. */
  scene: { min: 3, max: 6 },
  /** A caption is read in passing: this many words at most, and the eyebrow over it shorter still. */
  captionWords: 7,
  eyebrowWords: 3,
} as const;

/** The order the film goes in, which is the picture of the app it leaves: what it is, how things get into it, working
 *  through them, asking the assistant, and making it one's own. A scene belongs to one chapter and plays with it; the
 *  chapters never run backwards, so a new scene joins its chapter, never the end of the film. */
export const CHAPTERS = ["what", "in", "do", "ask", "yours"] as const;
export type Chapter = (typeof CHAPTERS)[number];

export type Slot = "pinned" | "rotating";

export type Shot = {
  scene: SceneName;
  chapter: Chapter;
  slot: Slot;
  /** The small line over the caption: where this is, or what it is called. */
  eyebrow: string;
  /** The one line the viewer reads. It claims only what the scene shows and the app does. */
  caption: string;
  seconds: number;
  /** The release that shipped what the scene shows, a heading of CHANGELOG.md: how old a rotating scene's news is. */
  since: string;
  /** Why it holds its slot: what a newcomer is weighed against. */
  why: string;
};

/** The words before the first scene: the site's headline, its last words in the brand's colour. */
export const OPENING = { seconds: 3, line: "One notebook for your", accent: "whole life." } as const;

export const STORYBOARD: Shot[] = [
  {
    scene: "Home", chapter: "what", slot: "pinned", seconds: 4, since: "0.1.0",
    eyebrow: "Laptop and phone", caption: "Notes and tasks, in one place.",
    why: "The establishing shot: what the app is, on both its screens, before any feature.",
  },
  {
    scene: "NewTask", chapter: "in", slot: "pinned", seconds: 4.5, since: "0.1.0",
    eyebrow: "New task", caption: "Type a task. It tags itself.",
    why: "The plainest way in, and the tags landing by themselves show that the app files what it is given.",
  },
  {
    scene: "Clip", chapter: "in", slot: "pinned", seconds: 5, since: "0.1.0",
    eyebrow: "Chrome clipper", caption: "Clip a page to the right note.",
    why: "The other way in, from the web: seen inside Chrome, with the note it suggests, which a bookmark never does.",
  },
  {
    scene: "Tasks", chapter: "do", slot: "pinned", seconds: 4, since: "0.1.0",
    eyebrow: "Tasks", caption: "Today, this evening, done.",
    why: "What happens to what went in: the day's list, and ticking a task is its smallest whole story.",
  },
  {
    scene: "Day", chapter: "ask", slot: "pinned", seconds: 5.5, since: "0.7.0",
    eyebrow: "Assistant", caption: "Ask about your day.",
    why: "The assistant has read the tasks, and it answers with a plan drawn as the app draws things, not with a paragraph.",
  },
  {
    scene: "Find", chapter: "ask", slot: "pinned", seconds: 6, since: "0.7.0",
    eyebrow: "Assistant", caption: "It finds notes and adds tasks.",
    why: "The assistant has read the notes too and acts on them: the two halves of the app meeting in one request.",
  },
  {
    scene: "Lens", chapter: "yours", slot: "rotating", seconds: 4.5, since: "0.10.0",
    eyebrow: "Lenses", caption: "Switch the lens. See only work.",
    why: "One tap changes every list and the app's colour: nothing else here shows as much in so little time.",
  },
  {
    scene: "Themes", chapter: "yours", slot: "rotating", seconds: 5, since: "0.5.0",
    eyebrow: "Themes", caption: "Sixteen themes. Pick yours.",
    why: "The most visual scene there is, and it ends the film on the app's own colours.",
  },
];

/** The words after the last scene: the README's line, then what kind of software this is. */
export const CLOSING = {
  seconds: 3.5, line: "Your notes and tasks.", accent: "On your own server.",
  notes: ["Open source", "Self-hosted", "Nothing to sign up for"],
} as const;

/** The film's still: this far (0 to 1) into this scene. */
export const POSTER = { scene: "Home", at: 0.8 } as const satisfies { scene: SceneName; at: number };

export type Segment = { name: string; start: number; seconds: number };

/** The film from start to end, in seconds: the opening, each shot, the closing. */
export function timeline(): Segment[] {
  let start = 0;
  return [{ name: "Opening", seconds: OPENING.seconds }, ...STORYBOARD.map((s) => ({ name: s.scene as string, seconds: s.seconds })), { name: "Closing", seconds: CLOSING.seconds }]
    .map((s) => { const segment = { ...s, start }; start += s.seconds; return segment; });
}

export const frames = (seconds: number) => Math.round(seconds * FPS);
