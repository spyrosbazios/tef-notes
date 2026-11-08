// The pieces the drawn screens are built from, each a copy in structure of the app's own (web/src/components/rail.tsx,
// home.tsx, planned.tsx, note-list.tsx, task-row.tsx, tag-badge.tsx, assistant/; the phone's (tabs)/_layout.tsx, ui/home.tsx,
// ui/days.tsx, ui/lens.tsx, ui/note-tile.tsx). Colours are the page's tokens, which are the app's; icons are lucide's, as in
// the app. Photos are drawn stand-ins in the note colours (index.css `.pic`), never pictures.
import {
  ArrowUp, BatteryFull, Bell, Calendar, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, CircleCheckBig, Eye, Flag, Focus,
  History, House, Inbox, ListChecks, Moon, NotebookText, Pin, Repeat, Search, Settings, Settings2, Signal, Sparkles,
  SquarePen, Star, Wifi, X, type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import type { Color } from "@/core/notes";
import { WEEKDAYS } from "@/core/planner";
import { cn } from "@/lib";
import { Brand, Mark } from "../ui";

/** The tags the demo notes and tasks carry, each in its colour (a tag's definition names one). */
export const TAG_COLOR: Record<string, Color> = {
  home: "yellow", work: "green", travel: "blue", reading: "purple", cooking: "orange", journal: "teal", errands: "pink",
};

/** A web tag badge in its definition's colour, painted with the note colours' tokens. */
export function Tag({ name, remove, className }: { name: string; remove?: boolean; className?: string }) {
  return (
    <span data-color={TAG_COLOR[name] ?? "gray"} className={cn("inline-flex h-5 shrink-0 items-center rounded-md border border-tile-line/50 bg-tile px-1.5 text-[11px] text-tile-fg", remove && "pr-0.5", className)}>
      #{name}{remove ? <X className="ml-1 size-3 opacity-60" /> : null}
    </span>
  );
}

/** The phone's tag badge: a pill in a wash of the tag colour's line. */
export function PTag({ name, className }: { name: string; className?: string }) {
  return (
    <span data-color={TAG_COLOR[name] ?? "gray"} className={cn("inline-flex h-[18px] shrink-0 items-center rounded-full bg-tile-line/[0.22] px-2 text-[10.5px] font-medium text-tile-fg", className)}>{name}</span>
  );
}

// ---- pictures ----

export type Pic = "dusk" | "lake" | "sun" | "doc" | "pdf";

/** A photo's stand-in (or a PDF's first page): a little landscape drawn in the note colours. */
export const Picture = ({ kind, className }: { kind: Pic; className?: string }) => <span className={cn("pic", `pic-${kind}`, className)} />;

/** A tile's pictures as the app lays them out (core/notes.ts mosaicCells): one fills, two split, three one tall and two
 *  stacked, four quarters. */
export function Mosaic({ pics, className }: { pics: Pic[]; className?: string }) {
  const n = pics.length;
  return (
    <div className={cn("grid gap-0.5 overflow-hidden bg-raised", n === 2 && "grid-cols-2", n >= 3 && "grid-cols-2 grid-rows-2", className)}>
      {pics.map((p, i) => <Picture key={i} kind={p} className={cn(n === 3 && i === 0 && "row-span-2")} />)}
    </div>
  );
}

// ---- the web app's rail ----

function RailItem({ icon: Icon, label, count, active }: { icon: LucideIcon; label: string; count?: number; active?: boolean }) {
  return (
    <div className={cn("flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm", active ? "bg-accent font-semibold text-brand" : "text-dim")}>
      <Icon className="size-4 shrink-0" />
      <span className="flex-1 truncate">{label}</span>
      {count != null ? <span className="text-xs tabular-nums text-faint">{count}</span> : null}
    </div>
  );
}

export const Kbd = ({ children }: { children: string }) => (
  <span className="flex h-5 min-w-5 items-center justify-center rounded-sm bg-muted px-1 text-xs font-medium text-dim">{children}</span>
);

export type RailView = "home" | "today";

const TASK_VIEWS: [LucideIcon, string, number?][] = [[Inbox, "Inbox", 3], [Star, "Today", 6], [CalendarDays, "Upcoming"], [CircleCheckBig, "Logbook"]];

/** The left rail: the mark (the way Home), search, the task lists, and at the foot the lens and settings. */
export function Rail({ active, lens }: { active: RailView; lens?: string }) {
  return (
    <nav className="flex h-full w-60 shrink-0 flex-col gap-4 border-r border-line p-3">
      <div className="px-2 pt-1"><Brand /></div>
      <div className="flex h-8 items-center gap-2 rounded-full border border-line px-3 text-sm text-dim"><Search className="size-4" /><span className="flex-1">Search</span><Kbd>/</Kbd></div>
      <div className="space-y-0.5">{TASK_VIEWS.map(([i, l, c]) => <RailItem key={l} icon={i} label={l} count={c} active={active === "today" && l === "Today"} />)}</div>
      <div className="flex-1" />
      <div className="space-y-0.5 border-t border-line pt-3">
        {lens ? (
          <div className="flex items-center gap-1">
            <div className="flex h-8 flex-1 items-center gap-2.5 rounded-lg bg-brand/15 px-2.5 text-sm font-semibold text-brand">
              <Focus className="size-4 shrink-0" /><span className="flex-1">{lens}</span>
            </div>
            <span className="flex size-8 items-center justify-center rounded-lg text-dim"><X className="size-4" /></span>
          </div>
        ) : <RailItem icon={Focus} label="Lens" />}
        <RailItem icon={Settings} label="Settings" />
      </div>
    </nav>
  );
}

/** The assistant's round button at the corner, while its dock is closed. */
export const Fab = () => (
  <span className="absolute bottom-5 right-5 flex size-14 items-center justify-center rounded-full bg-brand text-bg shadow-lift"><Sparkles className="size-6" /></span>
);

/** A web screen: the rail, the view's columns, and the assistant (its dock, or the button that opens it). */
export function WebShell({ active, lens, dock, children }: { active: RailView; lens?: string; dock?: ReactNode; children: ReactNode }) {
  return (
    <div className="relative flex h-full w-full bg-bg">
      <Rail active={active} lens={lens} />
      <div className="relative flex min-w-0 flex-1">{children}</div>
      {dock ?? <Fab />}
    </div>
  );
}

// ---- notes ----

export type DemoNote = { title: string; snippet?: string; color?: Color; tags: string[]; pinned?: boolean; age: string; pics?: Pic[] };

export const NOTES: DemoNote[] = [
  { title: "Pasta e fagioli", color: "pink", tags: ["cooking"], pinned: true, age: "2m",
    snippet: "Thick, cheap, comforting. Better on day two. 2 tins of borlotti beans, drained; 1 onion, 1 carrot, 1 celery stalk, finely chopped; 3 garlic cloves; 1 tbsp tomato paste…" },
  { title: "Autumn trip: Lisbon in five days", tags: ["travel"], age: "1h", pics: ["dusk", "lake", "sun"],
    snippet: "Flights are booked. Apartment near the tram line, five nights." },
  { title: "Ideas worth keeping", color: "purple", tags: ["work", "reading"], pinned: true, age: "2m",
    snippet: "A running list. No filtering. A notes app should feel like paper: instant, quiet, yours. Every setting is a small failure of design." },
  { title: "Evening walk by the canal", color: "teal", tags: ["journal"], age: "3h", pics: ["lake"],
    snippet: "Cold, clear and quiet. Walked the long way home along the canal." },
  { title: "Boiler manual", tags: ["home"], age: "2d", pics: ["pdf"], snippet: "Service every September. Pressure between 1 and 1.5 bar." },
  { title: "Gift ideas", color: "yellow", tags: ["home"], age: "1d",
    snippet: "Keep adding to this through the year. Hand-thrown mug set. A good paperback. Spice box with small jars." },
  { title: "Kitchen paint samples", tags: ["home"], age: "4d", pics: ["sun", "doc"] },
];

const clamp = (n: number) => ({ display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: n, overflow: "hidden" }) as const;

/** A note as a tile (web/src/components/note-list.tsx): its pictures flush on top, its colour's tint, title, a preview, tags, pin
 *  and age. The installed app draws the same tile at phone width, two columns, with no more than two tags (`maxTags`). */
export function NoteTile({ note, maxTags }: { note: DemoNote; maxTags?: number }) {
  const tinted = !!note.color;
  return (
    <div data-color={note.color} className={cn("overflow-hidden rounded-2xl border", tinted ? "border-tile-line/50 bg-tile text-tile-fg" : "border-line bg-card")}>
      {note.pics ? <Mosaic pics={note.pics} className={note.pics.length >= 3 ? "h-44" : "h-32"} /> : null}
      <div className="flex flex-col gap-1.5 p-3">
        <h3 className="text-[15px] font-semibold leading-snug" style={clamp(2)}>{note.title}</h3>
        {note.snippet ? <p className={cn("text-[13px] leading-snug", tinted ? "opacity-85" : "text-dim")} style={clamp(6)}>{note.snippet}</p> : null}
        <span className="flex flex-wrap gap-1">{note.tags.slice(0, maxTags).map((t) => <Tag key={t} name={t} />)}</span>
        <span className={cn("flex items-center gap-1.5 text-[11px] tabular-nums", tinted ? "text-tile-line" : "text-faint")}>{note.pinned ? <Pin className="size-3" /> : null}{note.age}</span>
      </div>
    </div>
  );
}

// ---- checkboxes ----

/** The square box of a markdown `- [ ]` line. */
export function Box({ on, size = 18 }: { on?: boolean; size?: number }) {
  return (
    <span style={{ width: size, height: size }} className={cn("flex shrink-0 items-center justify-center rounded-[4px] border-2", on ? "border-brand bg-brand text-bg" : "border-faint bg-muted")}>
      {on ? <svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth={4}><path d="M20 6 9 17l-5-5" /></svg> : null}
    </span>
  );
}

/** One checkbox line of a note. */
export function BoxLine({ on, children, phone }: { on?: boolean; children: ReactNode; phone?: boolean }) {
  return (
    <div className={cn("flex items-center gap-3 text-[16px]", on && "text-faint line-through decoration-faint")}>
      <Box on={on} size={phone ? 20 : 18} />{children}
    </div>
  );
}

/** The round box of a task. */
export function Radio({ on, size = 18 }: { on?: boolean; size?: number }) {
  return (
    <span style={{ width: size, height: size }} className={cn("flex shrink-0 items-center justify-center rounded-full", size > 20 ? "border-2" : "border-[1.5px]", on ? "border-brand bg-brand text-bg" : "border-faint")}>
      {on ? <svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth={3.5}><path d="M20 6 9 17l-5-5" /></svg> : null}
    </span>
  );
}

const Meta = ({ icon: Icon, children, className }: { icon: LucideIcon; children: ReactNode; className?: string }) => (
  <span className={cn("inline-flex items-center gap-1", className)}><Icon className="size-3" />{children}</span>
);

export type DemoTask = {
  title: string; checklist?: [number, number]; when?: string; every?: string; remind?: string; due?: string; note?: string; tags?: string[]; done?: boolean;
};

/** A task row: round box, title, a quiet second line (its note, checklist, day, repeat, reminder, tags), the deadline in
 *  the warn colour beside the row (web/src/components/task-row.tsx). The installed app draws the same row at phone width. */
export function TaskRow({ task, selected }: { task: DemoTask; selected?: boolean }) {
  const due = task.due ? <Meta key="d" icon={Flag} className="text-warn">{task.due}</Meta> : null;
  const meta = [
    task.note ? <Meta key="n" icon={NotebookText}>{task.note}</Meta> : null,
    task.checklist ? <Meta key="c" icon={ListChecks} className="tabular-nums">{task.checklist[0]}/{task.checklist[1]}</Meta> : null,
    task.when ? <Meta key="w" icon={Calendar}>{task.when}</Meta> : null,
    task.every ? <Meta key="e" icon={Repeat}>{task.every}</Meta> : null,
    task.remind ? <Meta key="r" icon={Bell}>{task.remind}</Meta> : null,
    ...(task.tags ?? []).map((t) => <Tag key={t} name={t} />),
  ].filter(Boolean);
  return (
    <div className={cn("flex items-start gap-3 rounded-xl px-3 py-2", selected && "bg-muted")}>
      <span className="mt-0.5"><Radio on={task.done} size={18} /></span>
      <div className="min-w-0 flex-1">
        <p className={cn("text-[15px] leading-snug", task.done ? "text-faint line-through decoration-faint" : "text-fg")}>{task.title}</p>
        {meta.length ? <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-faint">{meta}</div> : null}
      </div>
      {due ? <span className="mt-0.5 shrink-0 text-xs">{due}</span> : null}
    </div>
  );
}

/** This Evening's heading inside a list; on the phone a title over a hairline (task-list.tsx). */
export const Evening = ({ phone }: { phone?: boolean }) => (
  <p className={cn("flex items-center font-semibold", phone ? "mx-3 mb-1 mt-5 gap-2 border-b border-line pb-2 text-[15px] font-extrabold" : "gap-1.5 px-3 pb-1 pt-5 text-sm")}>
    <Moon className={phone ? "size-3.5 text-brand" : "size-3.5 text-dim"} />This Evening
  </p>
);

/** The task box's head: Today, the Inbox and Upcoming as quiet words, the chosen one in full (on the phone on a capsule). */
export function BoxWords({ phone }: { phone?: boolean }) {
  return (
    <div className={cn("flex min-w-0 flex-1 items-center", phone ? "gap-0.5 text-[17px]" : "gap-5 text-[22px] tracking-tight")}>
      <span className={cn("flex items-center gap-2 font-bold", phone && "gap-1.5 rounded-full bg-accent px-2 py-0.5 font-extrabold")}><Star className={cn("text-brand", phone ? "size-[17px]" : "size-5")} />Today</span>
      <span className={cn("font-bold opacity-25", phone && "px-2 py-0.5 font-extrabold")}>Inbox</span>
      <span className={cn("font-bold opacity-25", phone && "px-2 py-0.5 font-extrabold")}>Upcoming</span>
    </div>
  );
}

// ---- the planner: planned tasks a day, as the app shades them (core/planner.ts, 1 to 4 or more) ----

export const SHADE = ["bg-fg/[0.05]", "bg-brand/20", "bg-brand/40", "bg-brand/65 text-bg", "bg-brand text-bg"] as const;

/** November 2026's open tasks a day, today the 2nd. */
export const PLANNED: Record<number, number> = { 2: 2, 3: 1, 4: 3, 5: 1, 7: 1, 11: 2, 14: 4, 18: 1, 21: 1, 25: 2, 28: 1 };

/** The web Home's month: a heatmap of planned tasks, Monday first. */
export function Planner() {
  const lead = 6; // 1 November 2026 is a Sunday
  return (
    <section className="flex h-[416px] min-w-0 flex-col">
      <header className="flex items-center gap-1 pb-3">
        <b className="mr-auto flex items-center gap-2 text-[22px] font-bold tracking-tight"><CalendarDays className="size-5 text-brand" />November</b>
        <span className="flex size-8 items-center justify-center text-dim"><ChevronLeft className="size-4" /></span>
        <span className="flex size-8 items-center justify-center text-dim"><ChevronRight className="size-4" /></span>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-7 gap-1.5" style={{ gridTemplateRows: "auto repeat(6, minmax(0, 1fr))" }}>
        {WEEKDAYS.map((w) => <span key={w} className="pb-0.5 text-center text-[11px] font-medium text-faint">{w}</span>)}
        {Array.from({ length: lead }, (_, i) => <span key={`l${i}`} />)}
        {Array.from({ length: 30 }, (_, i) => {
          const d = i + 1;
          return (
            <span key={d} className={cn("flex items-start justify-end rounded-lg p-1.5 text-[11px] leading-none tabular-nums text-dim", SHADE[Math.min(PLANNED[d] ?? 0, 4)],
              d < 2 && "opacity-40", d === 2 && "font-semibold text-fg ring-2 ring-brand ring-offset-1 ring-offset-bg")}>{d}</span>
          );
        })}
      </div>
      <footer className="flex items-center justify-between pt-3 text-[11px] text-faint">
        <p><b className="font-semibold tabular-nums text-fg">14</b> planned, up to <b className="font-semibold tabular-nums text-fg">4</b> a day</p>
        <span className="flex items-center gap-1">Fewer{SHADE.map((s) => <span key={s} className={cn("size-2 rounded-[2px]", s)} />)}More</span>
      </footer>
    </section>
  );
}

/** The phone's form of the planner: a strip of days past a fixed slot, the slot's day the one the task box shows. */
export function Days() {
  const days: [string, number, number][] = [["Sat", 31, -2], ["Sun", 1, -1], ["Mon", 2, 0], ["Tue", 3, 1], ["Wed", 4, 2], ["Thu", 5, 3]];
  return (
    <div className="relative mx-3">
      <p className="text-center text-[11px] font-medium text-faint">November</p>
      <div className="relative flex h-[68px] items-center justify-center gap-1.5 overflow-hidden">
        {days.map(([wd, dn, off]) => {
          const n = dn > 20 ? 0 : PLANNED[dn] ?? 0, far = Math.abs(off);
          return (
            <div key={dn} style={{ opacity: off < 0 ? 0.35 : far <= 1 ? 1 : 0.55 }}
              className={cn("h-14 w-[52px] shrink-0 rounded-xl border-2", far === 0 ? "border-brand" : "border-transparent")}>
              <span className={cn("flex h-full flex-col items-center justify-center rounded-[10px] text-dim", SHADE[Math.min(n, 4)], far === 0 && n < 3 && "text-brand")}>
                <b className="text-[11px] font-medium leading-tight opacity-80">{wd}</b>
                <b className={cn("text-[17px] leading-tight tabular-nums", far === 0 ? "font-bold" : "font-medium")}>{dn}</b>
              </span>
            </div>
          );
        })}
        <span className="absolute inset-y-0 left-0 w-7 bg-gradient-to-r from-bg to-transparent" />
        <span className="absolute inset-y-0 right-0 w-7 bg-gradient-to-l from-bg to-transparent" />
      </div>
    </div>
  );
}

// ---- chat ----

/** The owner's message: a quiet raised bubble (web/src/components/assistant/turn.tsx), on the phone too. */
export const UserBubble = ({ children }: { children: ReactNode }) => (
  <div className="flex justify-end">
    <p className="max-w-[85%] rounded-2xl bg-raised px-3.5 py-2 text-sm leading-snug">{children}</p>
  </div>
);

/** A turn's quiet steps folded into one line (core/agent.ts `gist`: "Read 1 note · read tasks"), opened with the chevron. */
export const ToolLine = ({ children }: { children: ReactNode }) => (
  <div className="flex items-center gap-2 py-0.5 text-sm text-dim"><ListChecks className="size-4" /><span className="flex-1">{children}</span><ChevronDown className="size-4" /></div>
);

/** The card of a note the agent found: title, a preview, tags. */
export function ChatNote() {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-card">
      <div className="flex flex-col gap-1.5 p-3">
        <h3 className="text-[15px] font-semibold leading-snug">Pasta e fagioli</h3>
        <div className="relative max-h-28 overflow-hidden text-[13px] text-dim">
          <p>Thick, cheap, comforting. Better on day two.</p>
          <p className="mt-2.5 text-[17px] font-bold text-faint">Ingredients</p>
          <ul className="mt-1.5 space-y-1.5">
            {["2 tins of borlotti beans, drained", "1 onion, 1 carrot, 1 celery stalk"].map((l) => (
              <li key={l} className="flex items-center gap-2.5"><span className="size-1 rounded-full bg-brand" />{l}</li>
            ))}
          </ul>
          <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-b from-transparent to-card" />
        </div>
        <span className="flex gap-1"><Tag name="cooking" /></span>
      </div>
    </div>
  );
}

/** A write the agent proposes (web/src/components/assistant/confirm.tsx): the question (core/agent.ts `todoWords`), why,
 *  the tasks as numbered lines, and two pills. Nothing is written before the first. */
export function ConfirmCard({ title, why, tasks }: { title: string; why?: string; tasks: DemoTask[] }) {
  const line = (t: DemoTask) => [t.when?.toLowerCase(), t.tags?.length ? `tags: ${t.tags.join(", ")}` : null].filter(Boolean).join("; ");
  return (
    <div className="space-y-3 rounded-2xl border border-brand/40 bg-card p-4">
      <p className="text-sm font-semibold">{title}</p>
      {why ? <p className="text-[13px] text-dim">{why}</p> : null}
      <div className="space-y-1 border-t border-line pt-3 text-sm">
        {tasks.map((t, i) => <p key={t.title}>{i + 1}. {t.title}{line(t) ? <span className="text-dim"> ({line(t)})</span> : null}</p>)}
      </div>
      <div className="flex gap-2 text-sm font-medium">
        <span className="flex h-8 flex-1 items-center justify-center rounded-full bg-brand text-bg">Add them</span>
        <span className="flex h-8 flex-1 items-center justify-center rounded-full bg-raised text-fg">Not now</span>
      </div>
    </div>
  );
}

/** The assistant's header (assistant/panel.tsx): model, past chats, a new chat, and the X that closes the dock (not on the phone, where Ask is a tab). */
export function AssistantHeader({ close }: { close?: boolean }) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-1 border-b border-line px-3 text-dim">
      <Sparkles className="size-4 text-brand" /><h2 className="px-1 text-[15px] font-bold tracking-tight text-fg">Assistant</h2><span className="flex-1" />
      <span className="flex h-8 items-center gap-0.5 px-2 text-faint"><Settings2 className="size-4" /><ChevronDown className="size-3" /></span>
      {[History, SquarePen, ...(close ? [X] : [])].map((I, i) => <span key={i} className="flex size-8 items-center justify-center"><I className="size-4" /></span>)}
    </header>
  );
}

/** What the assistant sees of the page, and the composer: a field and the round Send, which waits for a message. */
export function AssistantComposer({ sees, ready }: { sees: string; ready?: boolean }) {
  return (
    <div className="shrink-0 border-t border-line p-3">
      <p className="flex items-center gap-1.5 px-1 pb-1.5 text-xs text-faint"><Eye className="size-3.5" /><span className="truncate">{sees}</span></p>
      <div className="flex items-end gap-2 rounded-2xl border border-line bg-card p-2">
        <span className="min-h-9 flex-1 px-2 py-1.5 text-sm text-faint">Ask, or say what to note</span>
        <span className={cn("flex size-8 items-center justify-center rounded-full bg-brand text-bg", !ready && "opacity-50")}><ArrowUp className="size-4" /></span>
      </div>
    </div>
  );
}

/** The web assistant's dock: its header; the chat; what it sees of the page; the composer. */
export function Dock({ sees, children }: { sees: string; children: ReactNode }) {
  return (
    <aside className="flex h-full w-[400px] shrink-0 flex-col border-l border-line bg-bg">
      <AssistantHeader close />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden px-4 py-5">{children}</div>
      <AssistantComposer sees={sees} />
    </aside>
  );
}

// ---- the phone's chrome ----

/** The system bar: the time on the left, clear of the camera hole, the radios on the right. */
export function StatusBar() {
  return (
    <div className="flex h-10 shrink-0 items-end justify-between px-9 pb-1 text-[13px] font-medium">
      <span>9:41</span>
      <span className="flex items-center gap-1.5"><Signal className="size-3.5" /><Wifi className="size-3.5" /><BatteryFull className="size-4" /></span>
    </div>
  );
}

export type PhoneTab = "Home" | "Tasks" | "Ask" | "Settings";

const TABS: [LucideIcon, PhoneTab][] = [[House, "Home"], [ListChecks, "Tasks"], [Sparkles, "Ask"], [Settings, "Settings"]];

/** The floating pill of tabs: the active one's icon and label on a brand capsule, the rest icons alone. */
export function TabBar({ active }: { active: PhoneTab }) {
  return (
    <div className="shrink-0 bg-bg px-4 pb-5 pt-3">
      <div className="flex items-center justify-between rounded-full border border-line bg-raised p-1.5 shadow-lift">
        {TABS.map(([Icon, label]) => (
          <span key={label} className={cn("flex h-12 items-center justify-center gap-2 rounded-full", label === active ? "bg-accent px-4 text-brand" : "px-3 text-dim")}>
            <Icon className="size-[22px]" strokeWidth={label === active ? 2.4 : 2} />
            {label === active ? <span className="text-[14px] font-semibold">{label}</span> : null}
          </span>
        ))}
      </div>
    </div>
  );
}

/** A phone screen: status bar, the body, and (for the tab screens) the bar of tabs. */
export function PhoneShell({ tab, children }: { tab?: PhoneTab; children: ReactNode }) {
  return (
    <div className="flex h-full w-full flex-col bg-bg">
      <StatusBar />
      <div className="relative min-h-0 flex-1 overflow-hidden">{children}</div>
      {tab ? <TabBar active={tab} /> : <div className="flex h-5 shrink-0 items-center justify-center"><span className="h-1 w-28 rounded-full bg-fg/50" /></div>}
    </div>
  );
}

/** Home's header (web/src/components/home.tsx): the mark, which is the lens (its name beside it while one is on), and Search in the corner. */
export function HomeHeader({ lens, searching }: { lens?: string; searching?: boolean }) {
  return (
    <div className="flex h-11 items-center gap-1 pl-4 pr-2">
      <span className="flex min-w-0 flex-1">
        <span className="flex h-11 items-center gap-2.5">
          <Mark className="h-7" />
          {lens ? <span className="text-[15px] font-extrabold tracking-tight text-brand">{lens}</span> : null}
        </span>
      </span>
      <span className={cn("flex size-9 items-center justify-center", searching ? "text-brand" : "text-dim")}>{searching ? <X className="size-[22px]" /> : <Search className="size-[22px]" />}</span>
    </div>
  );
}
