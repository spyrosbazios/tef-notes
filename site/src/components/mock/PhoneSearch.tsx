import { ListTodo, Mic, Search } from "lucide-react";
import type { ReactNode } from "react";
import { HomeHeader, NOTES, NoteTile, PhoneShell, Tag, type DemoNote } from "./parts";

/** A matched word in a hit: semibold, no highlight. */
const Hit = ({ children }: { children: ReactNode }) => <strong className="font-semibold text-fg">{children}</strong>;

const Section = ({ title, count, children }: { title: string; count?: number; children: ReactNode }) => (
  <section className="pt-3">
    <h3 className="flex items-baseline gap-2 px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-faint">{title}{count ? <span className="font-normal tabular-nums">{count}</span> : null}</h3>
    {children}
  </section>
);

/** The notes that answer "soup" in the cooking tag: Home's own tiles (search-drawer.tsx `Tiles`), in its two columns. */
const HITS: DemoNote[] = [
  NOTES[0]!,
  { title: "Winter recipes", color: "orange", tags: ["cooking", "home"], age: "3d", snippet: "A lentil soup keeps three days, and the rye loaf freezes well. Roast the squash first, then the onions…" },
];

/** Search, Home's drawer (web/src/components/search-drawer.tsx): one field over notes and tasks with a mic at its end, a #tag as a
 *  chip inside it narrows both, inside the lens. Notes come back as Home's tiles, tasks as rows with their notes under them. */
export function PhoneSearch() {
  return (
    <PhoneShell tab="Home">
      <div className="pt-2">
        <HomeHeader lens="Home" searching />
        <div className="px-4 pb-2 pt-1">
          <div className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-2xl border border-ring bg-card px-3 py-1.5">
            <Search className="size-4 shrink-0 text-dim" />
            <Tag name="cooking" remove className="h-5" />
            <span className="min-w-24 flex-1 py-1 text-base">soup<span className="ml-px inline-block h-5 w-0.5 bg-brand align-[-4px]" /></span>
            <span className="-mr-2 flex size-8 items-center justify-center rounded-full text-dim"><Mic className="size-4" /></span>
          </div>
          <p className="px-1 pt-2 text-xs text-faint">Searching inside Home</p>
        </div>
        <div className="px-3">
          <Section title="Notes" count={2}>
            <div className="flex items-start gap-3 px-1 pt-1">
              {HITS.map((n) => <div key={n.title} className="min-w-0 flex-1"><NoteTile note={n} maxTags={2} /></div>)}
            </div>
          </Section>
          <Section title="Tasks" count={1}>
            <div className="flex min-h-12 items-center gap-3 rounded-xl px-3 text-[15px]">
              <ListTodo className="size-5 shrink-0 text-dim" />
              <span className="min-w-0 flex-1"><span className="block truncate">Buy stock for the <Hit>soup</Hit></span><span className="block truncate text-xs text-dim">Borlotti beans, celery, a parmesan rind</span></span>
            </div>
          </Section>
        </div>
      </div>
    </PhoneShell>
  );
}
