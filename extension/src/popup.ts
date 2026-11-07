// The popup is in sections: the page (title and site), its tags, the details (title, note, summary) and where it goes.
// The choice of where a page (or a picture on it) goes, then how saving it went. Opened two ways: the toolbar button's
// popup (the current tab's page) and, from the context menu, a small window carrying a handed-over page
// (?handoff=<id>, handoff.ts). A picture is read first (its bytes, and the smaller copy JEV looks at), then filed as a
// page is. The server suggests (nothing written), the owner picks with one click or Enter, then the
// server saves there. An optional note: typing one asks for suggestions again with it as context (after a pause, or
// on leaving the box), and the save writes it up under the clip. Tags: asked for beside the suggestions, so they show
// as soon as JEV has them; the preselected ones are chips, a tap takes one off, the other likely ones are offered to add,
// and any defined tag can be added from the list. Until the owner changes them, a new note asks for them again. An optional title is used when it goes to a new note or a new task. "Add a summary" (remembered) has the server write one
// under the link or picture; when it couldn't, the result says so. Keyboard: the top option has focus, arrows move,
// Enter or Space picks, Ctrl/Cmd+Enter in the title or note saves to the top option, Escape closes.
import "virtual:tefnotes-theme.css";
import "./ui.css";
import { type Choice, choices, type ClipResult, type ClipTags, describe, type Suggestions, summaryNotice, type Target, titled } from "@/core/clip";
import { type Page, readTab, save, SetupError, suggest, tagsFor } from "./clip";
import { take } from "./handoff";
import { draw, icon, mark } from "./icons";
import { allow, type Picture, picture, PictureError } from "./picture";
import { getSummary, setSummary } from "./settings";

const status = document.getElementById("status")!;
const list = document.getElementById("choices")!;
const preview = document.getElementById("preview") as HTMLImageElement;
const titleBox = document.getElementById("title") as HTMLInputElement;
const noteBox = document.getElementById("note") as HTMLTextAreaElement;
const pageBox = document.getElementById("page")!;
const sections = ["page", "tags-section", "details", "dest"].map((id) => document.getElementById(id)!);
const tagsBox = document.getElementById("tags")!;
const offeredBox = document.getElementById("offered")!;
const addTag = document.getElementById("add-tag") as HTMLSelectElement;
const summaryBox = document.getElementById("summary") as HTMLInputElement;
document.getElementById("brand")!.append(mark(20), "TEF Notes");

const handoff = new URLSearchParams(location.search).get("handoff");
if (!handoff) document.documentElement.classList.add("action");
const CLOSE_MS = 1500;   // the context menu's window, once saved: long enough to read the result
const CLOSE_NOTICE_MS = 5000;   // ... and long enough to read that a summary was left out
const RERANK_MS = 900;   // a pause in typing the note before asking again

const message = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");

/** `action`: a button under the message, e.g. the settings, or allowing access and trying again. */
function show(kind: "busy" | "done" | "fail", lines: string[], action?: { label: string; run: () => void }) {
  status.className = `status ${kind}`;
  const text = document.createElement("div");
  lines.forEach((line, i) => {
    const p = document.createElement("div");
    p.className = i === 0 ? "title" : "dim";
    p.textContent = line;
    text.append(p);
  });
  if (action) {
    const b = document.createElement("button");
    b.textContent = action.label;
    b.addEventListener("click", action.run);
    text.append(b);
  }
  status.replaceChildren(draw(icon[kind]), text);
  status.hidden = false;
}
const quiet = () => { status.hidden = true; status.replaceChildren(); };
const reveal = (on: boolean) => { for (const s of sections) s.hidden = !on; };

const settings = { label: "Open settings", run: () => void chrome.runtime.openOptionsPage() };
const fail = (e: unknown) => show("fail", [message(e)], e instanceof SetupError ? settings : undefined);

/** A note's options draw an append, a task's a checklist, a new note's a page, a new task's a clipboard: the pick first
 *  (emphasised), the others best first, a new note unless it is the pick, a new task last. */
const glyph = (c: Choice) => ({ task: icon.task, note: icon.append, new: icon.create, newtask: icon.newtask })[c.target.kind];

/** What is being filed: the page, its picture once read, the latest suggestions and the note they were made with. */
const clip: { page?: Page; pic?: Picture; s?: Suggestions; options: Choice[]; ranked: string; asking: number; saving: boolean } = { options: [], ranked: "", asking: 0, saving: false };

/** The page's card: its title and its site. */
function drawPage(page: Page) {
  const text = document.createElement("div"), t = document.createElement("div"), host = document.createElement("div");
  t.className = "title";
  t.textContent = page.title;
  host.className = "dim small";
  host.textContent = page.url ? new URL(page.url).host.replace(/^www\./, "") : "";
  text.append(t, host);
  pageBox.replaceChildren(draw(icon.page, 16), text);
}

/** Offered beside the picked chips: a tag JEV gives at least this chance that is not picked. */
const OFFER = 0.3;
const tags: { all: ClipTags["tags"]; picked: string[]; touched: boolean; asking: number; state: "busy" | "ready" | "fail" } =
  { all: [], picked: [], touched: false, asking: 0, state: "busy" };

const chip = (name: string, kind: "on" | "offer", hint?: string) => {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `chip ${kind}`;
  b.append(draw(kind === "on" ? icon.remove : icon.add, 12), name);
  if (hint) { const h = document.createElement("span"); h.className = "dim"; h.textContent = hint; b.append(h); }
  b.setAttribute("aria-label", kind === "on" ? `Remove the tag ${name}` : `Add the tag ${name}`);
  b.addEventListener("click", () => {
    tags.touched = true;
    tags.picked = kind === "on" ? tags.picked.filter((t) => t !== name) : [...tags.picked, name];
    drawTags();
  });
  return b;
};

function drawTags() {
  if (tags.state === "busy" && !tags.all.length) {
    const s = document.createElement("span");
    s.className = "dim small loading";
    s.append(draw(icon.busy, 12), "Tagging the page…");
    tagsBox.replaceChildren(s);
  } else if (!tags.picked.length) {
    const s = document.createElement("span");
    s.className = "dim small";
    s.textContent = tags.state === "fail" ? "Couldn't tag the page. Add tags below." : "No tags.";
    tagsBox.replaceChildren(s);
  } else tagsBox.replaceChildren(...tags.picked.map((t) => chip(t, "on")));
  const rest = tags.all.filter((t) => !tags.picked.includes(t.name));
  offeredBox.replaceChildren(...rest.filter((t) => t.p >= OFFER).map((t) => chip(t.name, "offer", `${Math.round(t.p * 100)}%`)));
  const more = rest.filter((t) => t.p < OFFER).map((t) => t.name).sort((a, b) => a.localeCompare(b));
  const first = new Option("Add a tag…", "");
  first.disabled = true;
  addTag.replaceChildren(first, ...more.map((n) => new Option(n, n)));
  addTag.value = "";
  addTag.hidden = !more.length;
}
addTag.addEventListener("change", () => {
  if (!addTag.value) return;
  tags.touched = true;
  tags.picked = [...tags.picked, addTag.value];
  drawTags();
});

/** JEV's tags for the page; the pick is taken only while the owner hasn't changed the chips, and a newer ask wins. */
async function tag() {
  const page = clip.page;
  if (!page) return;
  const n = ++tags.asking;
  tags.state = "busy";
  drawTags();
  try {
    const t = await tagsFor(page, noteBox.value.trim());
    if (n !== tags.asking) return;
    tags.all = t.tags;
    if (!tags.touched) tags.picked = t.picked;
    tags.state = "ready";
  } catch {
    if (n !== tags.asking) return;
    tags.state = "fail";
  }
  drawTags();
}

/** The choices for `s`; `focus` puts the keyboard on the top one (not while the note is being typed). */
function offer(s: Suggestions, focus: boolean) {
  clip.s = s;
  quiet();
  clip.options = choices(s, !!clip.page?.image);
  const buttons = clip.options.map((c, i) => {
    const b = document.createElement("button");
    b.className = i === 0 ? "choice pick" : "choice";
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = c.label;
    b.append(draw(glyph(c), 16), label);
    if (c.hint) {
      const hint = document.createElement("span");
      hint.className = "dim";
      hint.textContent = c.hint;
      b.append(hint);
    }
    b.addEventListener("click", () => void commit(c.target, b));
    return b;
  });
  list.replaceChildren(...buttons);
  reveal(true);
  if (focus) buttons[0]?.focus();
}

/** Suggestions for the page with the note as it is now; an answer overtaken by a newer question is dropped. */
async function rank(focus: boolean) {
  const page = clip.page;
  if (!page) return;
  const note = noteBox.value.trim(), n = ++clip.asking;
  clip.ranked = note;
  if (clip.s) show("busy", ["Finding where it fits, with your note…"]);
  try {
    const s = await suggest(page, note, clip.pic?.look);
    if (n === clip.asking && !clip.saving) offer(s, focus);
  } catch (e) {
    if (n !== clip.asking || clip.saving) return;
    if (clip.s) { offer(clip.s, false); show("fail", [message(e), "The choices are from before the note."]); }
    else fail(e);
  }
}

let pause: ReturnType<typeof setTimeout> | undefined;
const rerank = () => {
  clearTimeout(pause);
  if (!clip.s || clip.saving || noteBox.value.trim() === clip.ranked) return;
  void rank(false);
  if (!tags.touched) void tag();
};
summaryBox.addEventListener("change", () => void setSummary(summaryBox.checked));
noteBox.addEventListener("input", () => { clearTimeout(pause); pause = setTimeout(rerank, RERANK_MS); });
noteBox.addEventListener("blur", rerank);
const saveTop = (event: KeyboardEvent) => {
  if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey)) return;
  event.preventDefault();
  const top = list.querySelector<HTMLButtonElement>("button.choice"), first = clip.options[0];
  if (first && top && !top.disabled) void commit(first.target, top);
};
noteBox.addEventListener("keydown", saveTop);
titleBox.addEventListener("keydown", saveTop);

/** `button`: the option clicked, which spins while the save runs. */
async function commit(target: Target, button: HTMLButtonElement) {
  const page = clip.page;
  if (!page || clip.saving) return;
  clearTimeout(pause);
  clip.saving = true;
  const controls = [...document.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("section button, section input, section textarea, section select")];
  for (const c of controls) c.disabled = true;
  const glyphOf = button.firstElementChild!, spinner = draw(icon.busy, 16);
  spinner.classList.add("spin");
  glyphOf.replaceWith(spinner);
  button.classList.add("saving");
  let result: ClipResult;
  try {
    const title = titleBox.value.trim();
    result = await save(page, clip.s?.line, titled(target, title), noteBox.value.trim(), summaryBox.checked, tags.picked, clip.pic?.stored);
  } catch (e) {
    fail(e);
    spinner.replaceWith(glyphOf);
    button.classList.remove("saving");
    clip.saving = false;
    for (const c of controls) c.disabled = false;   // choose again, or the same once the cause is fixed
    return;
  }
  reveal(false);
  const notice = summaryNotice(result);
  show("done", [result.title, describe(result), ...(tags.picked.length ? [`Tagged ${tags.picked.join(", ")}`] : []), ...(notice ? [notice] : [])]);
  setTimeout(() => window.close(), notice ? CLOSE_NOTICE_MS : CLOSE_MS);
}

/** The page to file: handed over by the context menu, or the toolbar's current tab. */
async function source(): Promise<Page> {
  if (handoff) {
    const h = await take(handoff);
    if (!h) throw new Error("Nothing to save: this window was already used.");
    if ("error" in h) throw new Error(h.error);
    return h.page;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error("No page to save.");
  return readTab(tab);
}

/** The picture's bytes, when there is one, then the suggestions. Neither the extension nor the server could fetch it: the
 *  owner may let the extension reach the picture's site, which needs this click (nothing awaited before the request). */
async function read() {
  const image = clip.page?.image;
  if (image) {
    show("busy", ["Reading the picture…"]);
    try {
      clip.pic = await picture(image.src);
    } catch (e) {
      const origin = e instanceof PictureError ? e.origin : undefined;
      const host = origin ? new URL(origin).host : "";
      return show("fail", [message(e)], origin ? {
        label: `Allow reading pictures from ${host}`,
        run: () => void allow(origin).then((ok) => (ok ? read() : show("fail", [`Access to ${host} was not granted.`]))),
      } : undefined);
    }
    preview.src = clip.pic.preview;
    preview.alt = image.caption || image.alt || "";
    preview.hidden = false;
  }
  drawPage(clip.page!);
  pageBox.hidden = false;
  document.getElementById("tags-section")!.hidden = false;
  show("busy", ["Finding where it fits…"]);
  void tag();
  await rank(true);
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") return window.close();
  if (event.target === noteBox || event.target === titleBox || event.target === addTag || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;
  const buttons = [...list.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
  if (!buttons.includes(document.activeElement as HTMLButtonElement) && document.activeElement !== document.body) return;
  if (!buttons.length) return;
  event.preventDefault();
  const at = buttons.indexOf(document.activeElement as HTMLButtonElement), down = event.key === "ArrowDown";
  const next = at < 0 ? (down ? 0 : buttons.length - 1) : (at + (down ? 1 : -1) + buttons.length) % buttons.length;
  buttons[next]?.focus();
});

async function start() {
  show("busy", ["Reading the page…"]);
  summaryBox.checked = await getSummary().catch(() => false);
  try {
    clip.page = await source();
  } catch (e) {
    return fail(e);
  }
  await read();
}

void start();
