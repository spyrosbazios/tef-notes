import { ListTodo, Search, X } from "lucide-react";
import type { ReactNode } from "react";
import { HomeHeader, PhoneShell, PTag, Mosaic } from "./parts";

/** A matched word in a hit's snippet: semibold, no highlight (mobile/src/ui/note-tile.tsx). */
const Hit = ({ children }: { children: ReactNode }) => <strong className="font-semibold text-fg">{children}</strong>;

const Label = ({ children }: { children: string }) => <p className="px-4 pb-2 pt-4 text-[12px] font-semibold text-dim">{children}</p>;

/** A note hit, the tile the Home grid uses, full width, with the hit's snippet. */
function Tile({ title, color, tags, age, snippet, pics }: { title: string; color?: "pink" | "orange"; tags: string[]; age: string; snippet: ReactNode; pics?: boolean }) {
  return (
    <div data-color={color} className={color ? "mx-4 overflow-hidden rounded-2xl border border-tile-line/40 bg-tile text-tile-fg" : "mx-4 overflow-hidden rounded-2xl border border-line bg-card"}>
      {pics ? <Mosaic pics={["sun", "doc"]} className="m-1.5 mb-0 h-24 rounded-xl" /> : null}
      <div className="flex flex-col gap-2 p-3.5">
        <h3 className="text-[15px] font-semibold leading-snug">{title}</h3>
        <p className={color ? "text-[13px] leading-snug opacity-85" : "text-[13px] leading-snug text-dim"}>{snippet}</p>
        <span className="flex gap-1.5">{tags.map((t) => <PTag key={t} name={t} />)}</span>
        <span className={color ? "text-[11px] tabular-nums text-tile-line" : "text-[11px] tabular-nums text-faint"}>{age}</span>
      </div>
    </div>
  );
}

/** Search, Home's drawer (mobile/src/ui/search.tsx): one field over notes and tasks (accents forgiven, offline), a #tag
 *  as a token inside the field narrows both, inside the lens. Notes come back as tiles, tasks as list rows. */
export function PhoneSearch() {
  return (
    <PhoneShell tab="Home">
      <div className="pt-2">
        <HomeHeader lens="Home" searching />
        <div className="mx-4 mt-2 flex min-h-12 items-center gap-2 rounded-full bg-muted pl-4 pr-1">
          <Search className="size-[18px] shrink-0 text-dim" />
          <span className="flex h-7 items-center gap-1 rounded-full bg-accent pl-2.5 pr-1.5 text-[13px] font-medium text-brand">cooking<X className="size-3.5" /></span>
          <span className="flex-1 text-[16px]">soup<span className="ml-px inline-block h-5 w-0.5 bg-brand align-[-4px]" /></span>
          <span className="flex size-10 items-center justify-center text-dim"><X className="size-[18px]" /></span>
        </div>
        <p className="px-5 pt-1.5 text-[12px] text-faint">Searching inside Home</p>
        <Label>Notes</Label>
        <div className="flex flex-col gap-2">
          <Tile title="Pasta e fagioli" color="pink" tags={["cooking"]} age="2m" snippet={<>Thick, cheap, comforting: a bean <Hit>soup</Hit> that is better on day two. 2 tins of borlotti beans, drained; 1 onion, 1 carrot, 1 celery stalk…</>} />
          <Tile title="Winter recipes" color="orange" tags={["cooking", "home"]} age="3d" snippet={<>…a lentil <Hit>soup</Hit> keeps three days, and the rye loaf freezes well. Roast the squash first…</>} />
        </div>
        <Label>Tasks</Label>
        <div className="mx-4 overflow-hidden rounded-2xl bg-card">
          <div className="flex min-h-14 items-center gap-3 px-4 py-2">
            <span className="flex size-9 items-center justify-center rounded-xl bg-accent text-brand"><ListTodo className="size-[18px]" /></span>
            <div className="min-w-0 flex-1"><p className="text-[15px] font-medium">Buy stock for the <Hit>soup</Hit></p><p className="text-[13px] text-dim">Due Saturday</p></div>
          </div>
        </div>
      </div>
    </PhoneShell>
  );
}
