import { BookOpen, Check, ChevronDown, FileText, NotebookText, PenTool, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib";
import { THEMES, withAccent } from "@/core/theme";
import { Mosaic, Picture, PTag, Radio, TaskRow } from "./mock/parts";
import { Heading, Mark, Reveal, scoped, Spotlight } from "./ui";

/** Each feature is a detail of the app drawn at full size, and three or four words. */
type Feature = { title: string; text: string; art: ReactNode; wide?: boolean };

/** A terminal; its output lines (and a second command) appear one after another when the tile is hovered. */
const Term = ({ lines }: { lines: [string, string?][] }) => (
  <div className="space-y-1 rounded-lg border border-line bg-bg/70 px-3 py-2.5 font-mono text-[13px]">
    {lines.map(([l, out], i) => (
      <div key={l + i} className={i ? "hov-line" : undefined} style={i ? { transitionDelay: `${i * 220}ms` } : undefined}>
        {out ? <span className="text-dim">{out}</span> : <><span className="text-faint">$ </span><span className="text-fg">{l}</span></>}
      </div>
    ))}
  </div>
);

const Tool = ({ icon: I, label }: { icon: typeof BookOpen; label: string }) => (
  <span className="inline-flex items-center gap-1 rounded-full border border-line bg-card px-2 text-xs font-medium leading-5 text-dim"><I className="size-3.5" />{label}</span>
);

/** The same four items, seen through one lens: the lens's pill and its tags, and the items its tags let through; the
 *  rest fade. Two of these, Home in the brand and Work in teal, crossfade (index.css .lens-a / .lens-b). */
const ITEMS: [string, string, boolean?][] = [["Water the plants", "home"], ["Draft the quarterly review", "work"], ["Pasta e fagioli", "cooking", true], ["Planning, week 45", "work", true]];
const LENS_TAGS: Record<string, string[]> = { Home: ["home", "cooking"], Work: ["work"] };

function Through({ lens, className }: { lens: "Home" | "Work"; className: string }) {
  const keep = LENS_TAGS[lens]!;
  return (
    <div className={cn("absolute inset-0 flex flex-col", className)}>
      <div className="flex items-center gap-2">
        <span className="inline-flex h-9 items-center gap-1.5 rounded-full bg-accent pl-1.5 pr-2.5 text-sm font-semibold text-brand"><Mark className="h-6" />{lens}<ChevronDown className="size-3.5" /></span>
        <span className="text-xs text-faint">{keep.map((t) => `#${t}`).join(" ")}</span>
      </div>
      <div className="mt-3 space-y-1">
        {ITEMS.map(([title, tag, note]) => (
          <div key={title} className={cn("flex items-center gap-2.5 text-[13px] transition-opacity", !keep.includes(tag) && "opacity-20")}>
            {note ? <NotebookText className="size-4 text-dim" /> : <Radio size={16} />}
            <span className="flex-1 truncate">{title}</span><PTag name={tag} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** A sketch as Excalidraw draws one: wobbly strokes, round caps, a little tilt. A kitchen plan with an arrow and a label. */
const Sketch = () => (
  <svg viewBox="0 0 320 150" className="h-36 w-full" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <g className="text-fg" transform="rotate(-0.6 160 75)">
      <path d="M22 30 Q 23 29 120 30 T 118 108 Q 118 110 20 109 T 22 30" />
      <path d="M40 42 q 30 -2 60 1" strokeDasharray="3 5" />
      <path d="M140 60 q 2 -22 36 -24 q 36 2 34 26 q -2 24 -36 24 q -36 -2 -34 -26" />
      <path d="M156 61 l 8 7 l 14 -16" strokeWidth="2.4" />
      <path d="M240 36 q 40 -2 58 2 q 2 50 -2 70 q -36 2 -56 -2 q -2 -40 0 -70 z" />
      <path d="M252 50 h 32 M252 64 h 24 M252 78 h 30" strokeDasharray="1 0" className="text-dim" />
    </g>
    <g className="text-brand hov-draw" strokeWidth="2.2" pathLength={1}>
      <path d="M122 70 q 6 -8 16 -3" pathLength={1} />
      <path d="M132 64 l 7 3 l -5 6" pathLength={1} style={{ transitionDelay: "250ms" }} />
      <path d="M212 60 q 14 -2 26 0" pathLength={1} style={{ transitionDelay: "400ms" }} />
      <path d="M232 57 l 7 3 l -6 5" pathLength={1} style={{ transitionDelay: "650ms" }} />
    </g>
    <g className="text-dim" strokeWidth="1.6">
      <path d="M44 128 q 2 -4 6 0 t 6 0 M58 125 q 3 4 0 6 M66 124 q 0 8 0 8 q 5 -8 6 0 M80 128 q 2 -4 5 0 t 5 0" />
      <path d="M234 126 l 6 -4 l 5 7 M250 122 l 0 9 M258 126 q 3 -5 6 0 t 6 0" />
    </g>
  </svg>
);

/** A web page as it comes, banners and a sidebar around a column of text, which on hover clears to the article alone:
 *  Reader view. The clutter fades and slides out; the column widens and its lines fill. */
const Reader = () => (
  <div className="relative h-36 overflow-hidden rounded-xl border border-line bg-card p-2.5">
    <div className="hov-clutter absolute inset-x-2.5 top-2.5 h-5 rounded bg-raised" />
    <div className="hov-clutter absolute bottom-2.5 right-2.5 top-10 w-[30%] space-y-1.5 rounded bg-raised/70 p-1.5" style={{ transitionDelay: "60ms" }}>
      <div className="h-8 rounded bg-raised" /><div className="h-1.5 w-4/5 rounded bg-line" /><div className="h-1.5 w-3/5 rounded bg-line" /><div className="h-8 rounded bg-raised" />
    </div>
    <div className="hov-clutter absolute bottom-2.5 left-2.5 h-6 w-[62%] rounded bg-raised" style={{ transitionDelay: "120ms" }} />
    <div className="hov-article absolute left-2.5 top-10 w-[62%]">
      <div className="h-3 w-5/6 rounded bg-fg/80" />
      <div className="mt-2 space-y-1.5">
        {[1, 0.92, 0.97, 0.7, 0.95, 0.88].map((w, i) => <div key={i} className="h-1.5 rounded bg-dim/60" style={{ width: `${w * 100}%` }} />)}
      </div>
    </div>
    <span className="hov-pop absolute bottom-2 right-2 inline-flex items-center gap-1.5 rounded-full border border-line bg-bg/90 px-2.5 py-1 text-[12px] font-medium"><BookOpen className="size-3.5 text-brand" />Reader</span>
  </div>
);

const FEATURES: Feature[] = [
  {
    title: "Notes hold everything", text: "Photos, PDFs, drawings, tables.",
    art: (
      <div className="space-y-2">
        <Mosaic pics={["dusk", "lake", "sun"]} className="hov-mosaic h-24 rounded-xl" />
        <span className="hov-pop inline-flex items-center gap-1.5 rounded-lg border border-line bg-card px-2 py-0.5 text-sm"><FileText className="size-4 text-brand" />boarding-passes.pdf</span>
      </div>
    ),
  },
  {
    title: "Tasks with a rhythm", text: "Today, This Evening, Upcoming. Repeats roll over.",
    art: (
      <div className="-mx-2 space-y-0.5">
        <div className="hov-tick"><TaskRow task={{ title: "Book Sintra train tickets", due: "Wednesday", tags: ["travel"] }} /></div>
        <TaskRow task={{ title: "Water the plants", every: "Every 3 days" }} />
        <TaskRow task={{ title: "Pack the carry-on", checklist: [2, 4] }} />
      </div>
    ),
  },
  {
    title: "An assistant that asks first", text: "Every write is a card you approve.",
    art: (
      <div className="relative">
        <div className="hov-card space-y-2.5 rounded-2xl border border-brand/40 bg-card p-3.5 text-sm">
          <p className="font-semibold">Add 2 tasks?</p>
          <div className="space-y-0.5 border-t border-line pt-2.5"><p>1. Book the Sintra timed entry</p><p>2. Book a table for the last night</p></div>
          <div className="flex gap-2 font-medium"><span className="hov-press flex h-8 flex-1 items-center justify-center rounded-full bg-brand text-bg">Add them</span><span className="flex h-8 flex-1 items-center justify-center rounded-full bg-raised">Not now</span></div>
        </div>
        <p className="hov-done absolute inset-x-0 top-1/2 flex -translate-y-1/2 items-center justify-center gap-1.5 text-[13px] text-dim"><Check className="size-3.5 text-up" />Added 2 tasks</p>
      </div>
    ),
  },
  {
    title: "Lenses", text: "A set of tags every view keeps to, in its own colour.",
    art: (
      <div className="relative h-40">
        <Through lens="Home" className="lens-a" />
        <div style={scoped(withAccent(THEMES.oled, "teal"))} className="absolute inset-0 text-fg"><Through lens="Work" className="lens-b" /></div>
      </div>
    ),
  },
  {
    title: "Tags apply themselves", text: "As you type a task. In the background for notes.",
    art: (
      <div className="rounded-2xl border border-line bg-card px-4 py-3">
        <p className="text-[16px] font-medium">Buy stock for the soup<span className="ml-px inline-block h-5 w-0.5 bg-brand align-[-4px]" /></p>
        <div className="mt-2 flex gap-1.5"><span className="hov-pop"><PTag name="cooking" /></span><span className="hov-pop" style={{ transitionDelay: "150ms" }}><PTag name="errands" /></span></div>
      </div>
    ),
  },
  {
    title: "Links you will read", text: "Read clean, or a summary under it.",
    art: (
      <div>
        <div className="flex items-center gap-3 rounded-xl border border-line bg-card p-2.5">
          <Picture kind="sun" className="size-14 shrink-0 rounded-lg border border-line" />
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">Ten tascas worth the queue</p><p className="truncate text-xs text-faint">food-on-foot.example</p></div>
          <span className="flex shrink-0 flex-col gap-1"><Tool icon={BookOpen} label="Read" /><span className="hov-lit"><Tool icon={Sparkles} label="Summary" /></span></span>
        </div>
        <blockquote className="hov-pop mt-2 rounded-r-md border-l-2 border-line bg-card py-1 pl-3 text-[12px] leading-snug text-dim"><strong className="font-semibold text-fg">Summary</strong>: ten small places in Alfama; go before 19:30, cash at three.</blockquote>
      </div>
    ),
  },
  {
    title: "Drawings, in the page", text: "An Excalidraw sketch, saved with the note.",
    art: (
      <div className="relative overflow-hidden rounded-xl border border-line bg-card">
        <Sketch />
        <span className="absolute bottom-2 right-2 inline-flex items-center gap-1.5 rounded-full border border-line bg-bg/90 px-2.5 py-1 text-[12px] font-medium"><PenTool className="size-3.5 text-brand" />Edit in Excalidraw</span>
        <span className="absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-lg border border-line bg-bg/90 px-2 py-0.5 text-[12px]"><FileText className="size-3.5 text-brand" />kitchen-plan.excalidraw</span>
      </div>
    ),
  },
  {
    title: "Terminal and agents", text: "A CLI, and MCP if you want it.",
    art: <Term lines={[["tefnotes today"], ["", "○ Book Sintra train tickets   due Wed"], ["", "○ Water the plants            every 3d"], ["claude mcp add tefnotes …/agent/mcp"]]} />,
  },
  {
    title: "Reader view", text: "The linked article, clutter gone.",
    art: <Reader />,
  },
];

export function Features() {
  return (
    <section id="features" className="relative mx-auto max-w-6xl px-5 py-24 sm:px-8 md:py-32">
      <Heading eyebrow="Features" title="Everything a notebook should do." />
      <div className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f, i) => (
          <Reveal key={f.title} delay={(i % 3) * 80} className="h-full">
            <Spotlight className="group flex h-full flex-col rounded-card border border-line bg-glass p-5 backdrop-blur transition-colors hover:bg-card">
              <div className="flex min-h-36 flex-1 flex-col justify-center">{f.art}</div>
              <h3 className="mt-5 text-[17px] font-bold leading-snug tracking-tight">{f.title}</h3>
              <p className="mt-1 text-[14px] text-dim">{f.text}</p>
            </Spotlight>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
