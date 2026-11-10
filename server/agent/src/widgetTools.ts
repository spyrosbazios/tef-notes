// The agent's display tools, widgets the clients draw (contract and types: packages/core/src/widgets.ts). Each reads the
// owner's own records and returns `{ widget }`: the model never describes a layout, and a client draws a fixed component per widget
// type. They write nothing, so no confirm card. As show_items does, the model is told briefly what was shown (`toModelOutput`),
// never the whole payload, but always the ids and paths on it: a record written with web text in view counts as read when it
// comes back here (guard.ts READS). The rules they compute by are plan.ts's. find_free_slots is plain data for the model, no widget.
import { tool, type ModelMessage } from "ai";
import { z } from "zod";
import { noteCardOf, taskCardOf, type NoteCard, type TaskCard } from "@/core/agent";
import { HttpError } from "@/core/http";
import { inLens, lensProblem, type Lens, type LensAccentName } from "@/core/lens";
import { isNotePath, NOTES, parseNote } from "@/core/notes";
import * as pb from "@/core/pocketbase";
import { isDay, REMIND } from "@/core/todo";
import { THEME_NAMES } from "@/core/theme";
import { localDay } from "@/core/time";
import { weekOf } from "@/core/planner";
import { WIDGET_LIMITS, type DayWidget, type LensWidget, type LinkWidget, type NotesWidget, type QuoteWidget, type TasksWidget, type ReviewWidget, type WeekWidget } from "@/core/widgets";
import { definedTags, type Notes } from "./notes";
import { freeSlots, quoteIn, reviewOf, dayOfTasks, timelineOf, weekOfTasks, WORK } from "./plan";
import type { Todo } from "./todo";
import { DAY_RE } from "./todoTools";

const REVIEW_DAYS = 90, QUOTE = 600, HEADING = 60;
const ACCENTS = ["violet", "blue", "teal", "green", "amber", "orange", "rose", "pink"] as const satisfies readonly LensAccentName[];

/** A lens as create_lens and show_lens take it. */
export const LENS = z.object({
  name: z.string().min(1).max(40).describe("Its name, short, in the owner's words"),
  tags: z.array(z.string().min(1).max(60)).max(20).describe("Tags it shows (an item with any of them); [] to hide only `exclude`"),
  exclude: z.array(z.string().min(1).max(60)).max(20).optional().describe("Tags it hides"),
  accent: z.enum(ACCENTS).optional().describe(`The colour the app takes while it is on: ${ACCENTS.join(" ")}`),
  theme: z.enum(THEME_NAMES).optional().describe(`The theme the app takes while it is on: ${THEME_NAMES.join(" ")}`),
});

export type LensInput = z.infer<typeof LENS>;

/** `i` as a lens's fields, its tags the defined names they match, or why it can't be one. */
export async function lensFields(notes: Notes, i: z.infer<typeof LENS>): Promise<Omit<Lens, "rec"> | { error: string }> {
  const problem = lensProblem({ name: i.name, tags: i.tags, exclude: i.exclude ?? [] });
  if (problem) return { error: problem };
  const shows = await definedTags(notes, i.tags), hides = await definedTags(notes, i.exclude ?? []);
  if ("error" in shows) return shows;
  if ("error" in hides) return hides;
  return { name: i.name.trim(), tags: shows.tags, exclude: hides.tags, accent: i.accent ?? null, theme: i.theme ?? null };
}

const DATE = DAY_RE.describe("YYYY-MM-DD, worked out from today's date in <context>");
const HM = z.string().regex(REMIND, "HH:MM");

type Shown<W> = { widget: W; not_found?: string[] } | { error: string };
const bad = (date: string) => ({ error: `${date} is not a YYYY-MM-DD day.` });

/** A task as the model is told of it: its id and title, never the card. */
const ref = (c: { id: string; title: string }) => ({ id: c.id, title: c.title });

export function widgetTools(notes: Notes, todo: Todo, fromPage: (messages: ModelMessage[]) => Promise<boolean>) {
  return {
    show_day: tool({
      description: "Show the owner one day as a timeline in the chat: the tasks booked at an hour (a task holds its hour; two in one hour are flagged as a clash), then the others planned for the day or due on it. Default today. You get the same list back; answer in a line, don't list it again.",
      inputSchema: z.object({ date: DATE.optional().describe("Default today") }),
      execute: async ({ date = localDay() }): Promise<Shown<DayWidget>> =>
        isDay(date) ? { widget: dayOfTasks(await todo.tasks(), date) } : bad(date),
      toModelOutput: ({ output }) => ({
        type: "json",
        value: "widget" in output ? {
          shown: "day", date: output.widget.date, done: output.widget.done,
          booked: output.widget.booked.map((b) => ({ at: b.at, ...ref(b.task), ...(b.clash ? { clash: true } : {}) })),
          unscheduled: output.widget.unscheduled.map(ref), ...(output.widget.more ? { more: output.widget.more } : {}),
        } : output,
      }),
    }),

    show_week: tool({
      description: "Show the owner a week at a glance: seven days, each with how many open tasks it holds, how many are booked at an hour, how many are overdue and its first few titles. From `start` (any day) or, by default, this week's Monday.",
      inputSchema: z.object({ start: DATE.optional().describe("The first of the seven days; default this week's Monday") }),
      execute: async ({ start }): Promise<Shown<WeekWidget>> => {
        const today = localDay(), first = start ?? weekOf(today, 0);
        return isDay(first) ? { widget: weekOfTasks(await todo.tasks(), first, today) } : bad(first);
      },
      toModelOutput: ({ output }) => ({ type: "json", value: "widget" in output ? { shown: "week", start: output.widget.start, days: output.widget.days } : output }),
    }),

    show_review: tool({
      description: "Show the owner a review of the last days: tasks done and added, notes added and edited, tasks stalled (open and untouched for 14 days or more, longest first) and the busiest tags. Default 7 days.",
      inputSchema: z.object({ days: z.number().int().min(1).max(REVIEW_DAYS).optional().describe(`Default 7, at most ${REVIEW_DAYS}`) }),
      execute: async ({ days = 7 }): Promise<Shown<ReviewWidget>> => {
        const [tasks, stamps, all] = [await todo.tasks(), await todo.stamps(), await notes.list()];
        return { widget: reviewOf(tasks, stamps, all.filter((n) => n.path.startsWith(NOTES)), days) };
      },
      toModelOutput: ({ output }) => ({
        type: "json",
        value: "widget" in output ? {
          shown: "review", from: output.widget.from, to: output.widget.to, done: output.widget.done, added: output.widget.added,
          notesAdded: output.widget.notesAdded, notesEdited: output.widget.notesEdited, stalledTotal: output.widget.stalledTotal,
          stalled: output.widget.stalled.map((s) => ({ ...ref(s.task), idle: s.idle })), tags: output.widget.tags,
        } : output,
      }),
    }),

    show_quote: tool({
      description: `Show the owner a passage of one of their notes as a quote, with the note's title and the lines around it, tappable to open it. The quote must be word for word in the note (whitespace aside): read_note first, never from memory. Up to ${QUOTE} characters.`,
      inputSchema: z.object({ path: z.string().describe("notes/<file>.md"), quote: z.string().min(1).max(QUOTE).describe("The passage, exactly as the note has it") }),
      execute: async ({ path, quote }): Promise<Shown<QuoteWidget>> => {
        const m = isNotePath(path) ? await notes.meta(path) : undefined;
        if (!m) return { error: `No note ${path}. Notes by path, from the index or search_notes.` };
        const n = parseNote(m.path, m.text), found = quoteIn(n.body, quote);
        return found ? { widget: { type: "quote", path: m.path, title: n.title, ...found } } : { error: `That isn't in ${path} word for word. read_note it and quote exactly, or say it in your own words.` };
      },
      toModelOutput: ({ output }) => ({ type: "json", value: "widget" in output ? { shown: "quote", path: output.widget.path, title: output.widget.title } : output }),
    }),

    show_link: tool({
      description: "Show the owner a web page as a link card: its title, description, site and picture, as the server's link preview reads it (the server fetches the page itself, only public http(s) addresses). Not available once this chat has read web pages or a PDF: give the link as text then. You are told only that it was shown, never what the page says.",
      inputSchema: z.object({ url: z.string().regex(/^https?:\/\//i, "A full http(s) URL").max(2000) }),
      execute: async ({ url }, { messages }): Promise<Shown<LinkWidget>> => {
        if (await fromPage(messages)) return { error: "This chat has read the web or a PDF, so a link from it isn't fetched for a card: give the link as text." };
        try {
          const preview = await pb.linkPreview(notes.server, url);
          return pb.hasPreview(preview) ? { widget: { type: "link", preview } } : { error: "That page has no title or picture to show: give the link as text." };
        } catch (e) {
          return { error: e instanceof HttpError && e.status === 400 ? "The server won't fetch that address (only public http(s) pages): give the link as text." : "The server couldn't reach that page: give the link as text." };
        }
      },
      toModelOutput: ({ output }) => ({ type: "json", value: "widget" in output ? { shown: "link", url: output.widget.preview.url } : output }),
    }),

    show_lens: tool({
      description: "Preview a lens for the owner before they make it: how many notes and open tasks carry any of `tags` (any, when it has none) and none of `exclude`, and up to 5 of each as cards. Tags only those list_tags returns. This only shows: it saves nothing; create_lens saves one.",
      inputSchema: z.object({
        tags: z.array(z.string().min(1).max(60)).max(20).describe("Tags the lens shows; [] to hide only `exclude`"),
        exclude: z.array(z.string().min(1).max(60)).max(20).optional().describe("Tags it hides"),
        name: z.string().min(1).max(40).optional().describe("A name to propose for it"),
        accent: z.enum(ACCENTS).optional().describe(`A colour to propose: ${ACCENTS.join(" ")}`),
        theme: z.enum(THEME_NAMES).optional().describe(`A theme to propose: ${THEME_NAMES.join(" ")}`),
      }),
      execute: async ({ tags, exclude = [], name, accent, theme }): Promise<Shown<LensWidget>> => {
        const problem = lensProblem({ name: name ?? "Preview", tags, exclude });
        if (problem) return { error: problem };
        const shows = await definedTags(notes, tags), hides = await definedTags(notes, exclude);
        if ("error" in shows) return shows;
        if ("error" in hides) return hides;
        const lens: Lens = { rec: "", name: name ?? "", tags: shows.tags, exclude: hides.tags, accent: null, theme: null };
        const mine = (await notes.list()).filter((n) => n.path.startsWith(NOTES) && inLens(lens, n)).sort((a, b) => b.updated - a.updated);
        const tasks = (await todo.tasks()).filter((t) => !t.done && inLens(lens, t)).sort((a, b) => a.order - b.order);
        return {
          widget: {
            type: "lens", tags: lens.tags, exclude: lens.exclude, ...(name ? { name } : {}), ...(accent ? { accent } : {}), ...(theme ? { theme } : {}),
            notes: { count: mine.length, sample: mine.slice(0, WIDGET_LIMITS.sample).map((n) => noteCardOf(n.path, n.text)) },
            tasks: { count: tasks.length, sample: tasks.slice(0, WIDGET_LIMITS.sample).map(taskCardOf) },
          },
        };
      },
      toModelOutput: ({ output }) => ({
        type: "json",
        value: "widget" in output ? {
          shown: "lens", tags: output.widget.tags, exclude: output.widget.exclude,
          notes: { count: output.widget.notes.count, sample: output.widget.notes.sample.map((c) => ({ path: c.path, title: c.title })) },
          tasks: { count: output.widget.tasks.count, sample: output.widget.tasks.sample.map(ref) },
        } : output,
      }),
    }),

    show_tasks: tool({
      description: `Show the owner several tasks as a timeline in the chat: grouped under the day each falls on (its when, else its deadline), earliest first, those with no date last; each tickable and tappable. For "what do I have to do for X", "what's coming up at work": find them first (list_tasks, list_tagged), then call this with their ids (at most ${WIDGET_LIMITS.timeline}, the open ones unless asked for done) and a short heading. For one day's hours use show_day; for a few found items mixed with notes, show_items. Answer in a line after; don't list them again.`,
      inputSchema: z.object({
        ids: z.array(z.string().min(1)).min(1).max(WIDGET_LIMITS.timeline).describe("Task ids, from list_tasks or list_tagged"),
        title: z.string().min(1).max(HEADING).optional().describe("A short heading, e.g. \"Work this week\""),
      }),
      execute: async ({ ids, title }): Promise<Shown<TasksWidget>> => {
        const cards: TaskCard[] = [], missing: string[] = [];
        for (const id of new Set(ids)) { const c = await todo.taskCard(id); if (c) cards.push(c); else missing.push(id); }
        if (!cards.length) return { error: `No task ${missing.join(", ")}. Tasks by id, from list_tasks or list_tagged.` };
        return { widget: { type: "tasks", title: title ?? "", days: timelineOf(cards) }, ...(missing.length ? { not_found: missing } : {}) };
      },
      toModelOutput: ({ output }) => ({
        type: "json",
        value: "widget" in output ? {
          shown: "tasks", days: output.widget.days.map((d) => ({ date: d.date ?? "no date", tasks: d.tasks.map(ref) })),
          ...(output.not_found ? { not_found: output.not_found } : {}),
        } : output,
      }),
    }),

    show_notes: tool({
      description: `Show the owner several notes as a gallery of the tiles Home draws (picture, title, opening lines, tags), each tappable. For "show me my notes on X", a collection, a reading list: find them first (search_notes, list_tagged, list_notes), then call this with their paths (at most ${WIDGET_LIMITS.gallery}, the best first) and a short heading. For two or three found items show_items is enough. Answer in a line after; don't list them again.`,
      inputSchema: z.object({
        paths: z.array(z.string()).min(1).max(WIDGET_LIMITS.gallery).describe("notes/<file>.md, from the index or the note tools"),
        title: z.string().min(1).max(HEADING).optional().describe("A short heading, e.g. \"Recipes\""),
      }),
      execute: async ({ paths, title }): Promise<Shown<NotesWidget>> => {
        const cards: NoteCard[] = [], missing: string[] = [];
        for (const path of new Set(paths)) {
          const m = isNotePath(path) && path.startsWith(NOTES) ? await notes.meta(path) : undefined;
          if (m) cards.push(noteCardOf(m.path, m.text)); else missing.push(path);
        }
        if (!cards.length) return { error: `No note ${missing.join(", ")}. Notes by path, from the index or search_notes.` };
        return { widget: { type: "notes", title: title ?? "", notes: cards }, ...(missing.length ? { not_found: missing } : {}) };
      },
      toModelOutput: ({ output }) => ({
        type: "json",
        value: "widget" in output ? {
          shown: "notes", notes: output.widget.notes.map((c) => ({ path: c.path, title: c.title })),
          ...(output.not_found ? { not_found: output.not_found } : {}),
        } : output,
      }),
    }),

    find_free_slots: tool({
      description: `The gaps in one day where a task of this length fits, earliest first: what is left of the working hours (default ${WORK.from} to ${WORK.to}) once each open task booked that day holds its hour (a task has no length, so a booking takes the whole hour; unscheduled tasks take no time). For today nothing before now is offered. To let the owner pick one: ask_choice, then add_task or update_task with when and remind.`,
      inputSchema: z.object({
        date: DATE,
        minutes: z.number().int().min(15).max(600).describe("How long the thing takes"),
        from: HM.optional().describe(`Earliest start, default ${WORK.from}`),
        to: HM.optional().describe(`Latest end, default ${WORK.to}`),
      }),
      execute: async ({ date, minutes, from, to }) => {
        if (!isDay(date)) return bad(date);
        if (from && to && from >= to) return { error: "`from` has to be before `to`." };
        return { date, minutes, from: from ?? WORK.from, to: to ?? WORK.to, ...freeSlots(await todo.tasks(), date, minutes, from, to, new Date()) };
      },
    }),
  };
}
