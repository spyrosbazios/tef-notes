import { ListTodo, Search } from "lucide-react";
import type { ReactNode } from "react";
import { HomeHeader, Mosaic, PhoneShell, Tag } from "./parts";

/** A matched word in a hit's snippet: semibold, no highlight. */
const Hit = ({ children }: { children: ReactNode }) => <strong className="font-semibold text-fg">{children}</strong>;

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="pt-3"><h3 className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-faint">{title}</h3>{children}</section>
);

/** A note result (web/src/components/note-hit.tsx): a card in the note's colour, a small mosaic, title and age, two lines of prose, tags. */
function Result({ title, color, tags, age, snippet, pics }: { title: string; color?: "pink" | "orange"; tags: string[]; age: string; snippet: ReactNode; pics?: boolean }) {
  return (
    <div data-color={color} className={color ? "my-1 rounded-2xl border border-tile-line/50 bg-tile p-3 text-tile-fg" : "my-1 rounded-2xl border border-line bg-card p-3"}>
      <div className="flex items-start gap-3">
        {pics ? <Mosaic pics={["sun", "doc"]} className="size-14 shrink-0 rounded-md border border-line" /> : null}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-baseline gap-2">
            <span className="truncate font-semibold">{title}</span>
            <span className={color ? "ml-auto shrink-0 text-[11px] tabular-nums text-tile-line" : "ml-auto shrink-0 text-[11px] tabular-nums text-faint"}>{age}</span>
          </div>
          <p className={color ? "text-xs leading-normal" : "text-xs leading-normal text-dim"} style={{ display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 2, overflow: "hidden" }}>{snippet}</p>
          <span className="flex flex-wrap gap-1 pt-0.5">{tags.map((t) => <Tag key={t} name={t} />)}</span>
        </div>
      </div>
    </div>
  );
}

/** Search, Home's drawer (web/src/components/search-drawer.tsx): one field over notes and tasks, a #tag as a chip inside it narrows both,
 *  inside the lens. Notes come back as cards, tasks as rows. */
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
          </div>
          <p className="px-1 pt-2 text-xs text-faint">Searching inside Home</p>
        </div>
        <div className="px-3">
          <Section title="Notes">
            <Result title="Pasta e fagioli" color="pink" tags={["cooking"]} age="2m" pics snippet={<>Thick, cheap, comforting: a bean <Hit>soup</Hit> that is better on day two. 2 tins of borlotti beans, drained…</>} />
            <Result title="Winter recipes" color="orange" tags={["cooking", "home"]} age="3d" snippet={<>…a lentil <Hit>soup</Hit> keeps three days, and the rye loaf freezes well. Roast the squash first…</>} />
          </Section>
          <Section title="Tasks">
            <div className="flex min-h-12 items-center gap-3 rounded-xl px-3 text-[15px]">
              <ListTodo className="size-5 shrink-0 text-dim" />
              <span className="min-w-0 flex-1"><span className="block truncate">Buy stock for the <Hit>soup</Hit></span><span className="block truncate text-xs text-dim">Due Saturday</span></span>
            </div>
          </Section>
        </div>
      </div>
    </PhoneShell>
  );
}
