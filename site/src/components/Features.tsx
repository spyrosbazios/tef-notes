import { ArrowRight, BookOpen, Check, ChevronDown, Circle, FileText, Globe, MousePointer2, NotebookText, PenTool, Smartphone, Sparkles, Square, Type, X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib";
import { THEMES, withAccent } from "@/core/theme";
import { Mosaic, Picture, PTag, Radio, TaskRow } from "./mock/parts";
import { Heading, Mark, Reveal, scoped, Spotlight } from "./ui";

/** Each feature is a detail of the app drawn at full size, and three or four words. A `wide` one takes two columns. */
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
        <span className="inline-flex h-9 items-center gap-2 pr-2 text-[15px] font-extrabold tracking-tight text-brand"><Mark className="h-7" />{lens}<ChevronDown className="size-4" /></span>
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

/** Excalidraw's hand: every stroke drawn twice, the second a little off and fainter, a wobble in the lines. */
const Rough = ({ d, className, delay }: { d: string; className?: string; delay?: number }) => {
  const style = delay != null ? { transitionDelay: `${delay}ms` } : undefined;
  return (
    <g className={className}>
      <path d={d} pathLength={1} style={style} />
      <path d={d} pathLength={1} transform="translate(0.9 0.7)" opacity={0.45} style={style} />
    </g>
  );
};
const box = (x: number, y: number, w: number, h: number) =>
  `M${x} ${y} q${w / 2} -1.6 ${w} 0 q1.4 ${h / 2} 0 ${h} q-${w / 2} 1.6 -${w} 0 q-1.4 -${h / 2} 0 -${h} z`;
const blob = (cx: number, cy: number, rx: number, ry: number) =>
  `M${cx - rx} ${cy} q0.5 -${ry} ${rx} -${ry} q${rx} 0.5 ${rx} ${ry} q-0.5 ${ry} -${rx} ${ry} q-${rx} -0.5 -${rx} -${ry} z`;

/** A mind map as Excalidraw draws one: an ellipse in the middle, boxes around it, arrows between, one box hatched. The
 *  arrows draw and the hatching fills when the tile is hovered. The view box keeps a band under the drawing for the
 *  frame's chips (Drawing), so neither covers a box. */
const Sketch = () => (
  <svg viewBox="0 -6 320 186" className="h-44 w-full" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <defs>
      <pattern id="hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><path d="M0 0 V5" className="stroke-brand" strokeWidth="1" /></pattern>
    </defs>
    <g className="text-fg" transform="rotate(-0.8 160 75)">
      <Rough d={blob(160, 72, 48, 19)} />
      <text x="160" y="76" textAnchor="middle" fontSize="12" fontWeight="600" stroke="none" className="fill-fg">Lisbon trip</text>
      <Rough d={box(18, 20, 74, 26)} />
      <text x="34" y="37" fontSize="11" stroke="none" className="fill-fg">Flights</text>
      <path d="M72 33 l 4 4 l 8 -9" className="text-up" strokeWidth="2" />
      <path d={box(18, 104, 86, 26)} fill="url(#hatch)" stroke="none" className="hov-fade" />
      <Rough d={box(18, 104, 86, 26)} />
      <text x="30" y="121" fontSize="11" stroke="none" className="fill-fg">Sintra train</text>
      <Rough d={box(226, 58, 84, 26)} />
      <text x="240" y="75" fontSize="11" stroke="none" className="fill-fg">Where to eat</text>
      <Rough d={box(214, 108, 74, 26)} />
      <text x="228" y="125" fontSize="11" stroke="none" className="fill-fg">Pack list</text>
    </g>
    <g className="text-brand hov-draw" strokeWidth="1.8">
      <Rough d="M118 62 q -8 -12 -26 -22" />
      <Rough d="M96 46 l -4 -6 l 7 0" delay={200} />
      <Rough d="M124 82 q -12 10 -30 22" delay={280} />
      <Rough d="M101 100 l -7 4 l 1 -7" delay={480} />
      <Rough d="M208 70 q 8 1 18 1" delay={560} />
      <Rough d="M221 68 l 5 3 l -5 3" delay={720} />
      <Rough d="M196 86 q 10 14 18 22" delay={800} />
      <Rough d="M207 107 L214 108 L213 101" delay={960} />
    </g>
  </svg>
);

const TOOLS = [MousePointer2, Square, Circle, ArrowRight, PenTool, Type];

const BARS = [6, 12, 16, 10, 7];

/** Dictation, as the field's mic draws it (web/src/components/mic-button.tsx): the words so far in the field, the pill that
 *  listens (a red dot, bars that follow the voice, the clock, a cancel) and the stop button beside it. */
const Dictation = () => (
  <div className="mx-auto w-full max-w-md rounded-2xl border border-line bg-card px-4 py-3">
    <p className="text-[16px] leading-snug">Call the plumber about the radiator, Tuesday morning<span className="ml-px inline-block h-5 w-0.5 bg-brand align-[-4px]" /></p>
    <div className="mt-3 flex items-center justify-end gap-1.5">
      <span className="flex h-8 items-center gap-2 rounded-full border border-down/40 bg-down/10 px-2.5 text-xs font-semibold tabular-nums text-down">
        <span className="size-2 rounded-full bg-down" />Listening
        <span className="flex h-4 items-center gap-[2px]">{BARS.map((h, i) => <span key={i} className="w-[3px] rounded-full bg-down" style={{ height: h }} />)}</span>
        0:07<X className="size-3.5" />
      </span>
      <span className="flex size-8 items-center justify-center rounded-full bg-down text-bg"><Square className="size-4 fill-current" /></span>
    </div>
  </div>
);

/** Settings as they travel: a few rows of the owner's preferences, the same on the laptop and the phone. */
const Shared = () => (
  <div>
    <div className="divide-y divide-line rounded-2xl border border-line bg-card text-[13px]">
      {[["Theme", "Midnight"], ["Accent", "Teal"], ["Tabs", "Home · Tasks · Ask"], ["Opens on", "Today"]].map(([k, v]) => (
        <div key={k} className="flex items-center justify-between px-3 py-1.5"><span className="text-dim">{k}</span><span className="font-medium">{v}</span></div>
      ))}
    </div>
    <p className="mt-2 flex items-center gap-1.5 text-xs text-faint"><Globe className="size-3.5" /><Smartphone className="size-3.5" />The same on every device</p>
  </div>
);

/** The sketch in its frame: Excalidraw's island of tools on top, the file's name, and the way into Excalidraw. */
const Drawing = () => (
  <div className="relative overflow-hidden rounded-xl border border-line bg-card">
    <Sketch />
    <span className="absolute left-1/2 top-2 flex -translate-x-1/2 gap-0.5 rounded-lg border border-line bg-bg/90 p-0.5">
      {TOOLS.map((I, i) => <span key={i} className={cn("flex size-5 items-center justify-center rounded", i === 0 ? "bg-accent text-brand" : "text-dim")}><I className="size-3" /></span>)}
    </span>
    <span className="hov-pop absolute bottom-2 right-2 inline-flex items-center gap-1.5 rounded-full border border-line bg-bg/90 px-2.5 py-1 text-[12px] font-medium"><PenTool className="size-3.5 text-brand" />Edit in Excalidraw</span>
    <span className="absolute bottom-2 left-2 inline-flex items-center gap-1.5 rounded-lg border border-line bg-bg/90 px-2 py-0.5 text-[12px]"><FileText className="size-3.5 text-brand" />lisbon.excalidraw</span>
  </div>
);

const Line = ({ w, className }: { w: number; className?: string }) => <div className={cn("h-1.5 rounded bg-dim/50", className)} style={{ width: `${w}%` }} />;
const Ad = ({ className }: { className?: string }) => <div className={cn("flex items-center justify-center rounded bg-raised text-[9px] font-semibold tracking-wider text-faint", className)}>AD</div>;

/** A page as the web hands it over, a column of text hemmed in by a header, adverts and a cookie bar; hovered, it is
 *  the article alone, as the web app's Reader view shows it (components/reader.tsx): a title bar, the picture, the
 *  title, a line about it, the text. */
const Reader = () => (
  <div className="relative h-36 overflow-hidden rounded-xl border border-line bg-card">
    <div className="hov-out absolute inset-0 p-2.5">
      <div className="flex h-5 items-center gap-1.5 rounded bg-raised px-1.5">
        <span className="size-2.5 rounded-full bg-brand/70" /><span className="h-1.5 w-8 rounded bg-line" /><span className="h-1.5 w-6 rounded bg-line" /><span className="h-1.5 w-7 rounded bg-line" />
        <span className="ml-auto h-3 w-9 rounded-full bg-line" />
      </div>
      <div className="mt-2 flex gap-2">
        <div className="flex-1">
          <Ad className="h-6" />
          <div className="mt-2 h-2.5 w-5/6 rounded bg-fg/80" />
          <div className="mt-1 h-1 w-1/3 rounded bg-faint/60" />
          <div className="mt-2 space-y-1.5"><Line w={100} /><Line w={94} /><Line w={72} /></div>
        </div>
        <div className="w-[30%] space-y-1.5">
          <Ad className="h-10" />
          <Line w={90} className="bg-line" /><Line w={70} className="bg-line" />
          <Ad className="h-6" />
        </div>
      </div>
      <div className="absolute inset-x-2.5 bottom-2.5 flex h-6 items-center gap-2 rounded border border-line bg-bg/95 px-2">
        <span className="h-1.5 flex-1 rounded bg-line" /><span className="h-3.5 w-10 rounded-full bg-brand/80" />
      </div>
    </div>
    <div className="hov-in absolute inset-0 flex flex-col">
      <div className="flex h-7 shrink-0 items-center gap-2 border-b border-line px-3"><span className="min-w-0 flex-1 truncate text-[11px] font-semibold">Ten tascas worth the queue</span><X className="size-3 text-dim" /></div>
      <div className="px-5 pt-3">
        <Picture kind="sun" className="h-9 w-full rounded-md" />
        <p className="mt-2 text-[12px] font-semibold leading-tight">Ten tascas worth the queue</p>
        <p className="mt-0.5 text-[9px] text-faint">food-on-foot.example · 6 min</p>
        <div className="mt-2 space-y-1.5"><Line w={100} /><Line w={96} /><Line w={88} /></div>
      </div>
      <span className="absolute bottom-2 right-2 inline-flex items-center gap-1.5 rounded-full border border-line bg-bg/90 px-2.5 py-1 text-[12px] font-medium"><BookOpen className="size-3.5 text-brand" />Reader</span>
    </div>
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
    title: "Say it instead", text: "Dictate wherever you type. Transcribed on your own server, nothing kept.", wide: true,
    art: <Dictation />,
  },
  {
    title: "An assistant that asks first", text: "Each write is a card you approve, until you say it needn't.",
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
    art: <Drawing />,
  },
  {
    title: "Terminal and agents", text: "A CLI, and MCP if you want it.",
    art: <Term lines={[["tefnotes today"], ["", "○ Book Sintra train tickets   due Wed"], ["", "○ Water the plants            every 3d"], ["claude mcp add tefnotes …/agent/mcp"]]} />,
  },
  {
    title: "Reader view", text: "The linked article, clutter gone.",
    art: <Reader />,
  },
  {
    title: "Set up once", text: "Theme, accent, tabs and the lens that is on follow you to every device.",
    art: <Shared />,
  },
];

export function Features() {
  return (
    <section id="features" className="relative mx-auto max-w-6xl px-5 py-24 sm:px-8 md:py-32">
      <Heading eyebrow="Features" title="Everything a notebook should do." />
      {/* Dense: the wide tile takes two columns wherever it lands, and the next tile fills what it skipped */}
      <div className="mt-16 grid grid-cols-[minmax(0,1fr)] gap-4 [grid-auto-flow:dense] sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f, i) => (
          <Reveal key={f.title} delay={(i % 3) * 80} className={cn("h-full", f.wide && "sm:col-span-2")}>
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
