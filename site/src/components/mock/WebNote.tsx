import { Bold, BookOpen, Check, ChevronLeft, ChevronRight, Circle, Copy, Ellipsis, EllipsisVertical, FileText, Italic, Link2, ListTodo, Mic, Paperclip, Pin, Plus, Sparkles } from "lucide-react";
import { cn } from "@/lib";
import { Fab, Mosaic, Picture, Tag } from "./parts";

const Tool = ({ icon: I, label }: { icon: typeof BookOpen; label: string }) => (
  <span className="inline-flex items-center gap-1 rounded-full border border-line bg-card px-2 text-xs font-medium leading-5 text-dim"><I className="size-3.5" />{label}</span>
);

/** The Lisbon note on its own page: the editor's tools, the note, the tasks linked to it, a photo strip, a link as an item
 *  with Read and Summary (the summary written under it), a PDF's first page. `narrow` leaves room for the assistant's dock. */
export function LisbonPage({ narrow }: { narrow?: boolean }) {
  return (
    <article className="flex h-full min-w-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-1 border-b border-line px-4 text-dim">
        <span className="flex h-7 items-center gap-1 px-2 text-sm font-medium text-fg"><ChevronLeft className="size-4" />Back</span>
        <span className="flex gap-0.5">{[Bold, Italic, ListTodo, Link2, Ellipsis].map((I, i) => <span key={i} className="flex h-7 min-w-7 items-center justify-center"><I className="size-4" /></span>)}</span>
        <span className="ml-2 flex items-center gap-1.5 text-xs text-faint"><Check className="size-3" />Saved</span>
        <span className="flex-1" />
        {[Mic, Paperclip, Pin, EllipsisVertical].map((I, i) => <span key={i} className="flex size-8 items-center justify-center"><I className="size-4" /></span>)}
      </header>
      <div className={cn("mx-auto w-full max-w-3xl pt-8", narrow ? "px-12" : "px-10")}>
        <h1 className="text-[30px] font-extrabold leading-tight tracking-tight">Autumn trip: Lisbon in five days</h1>
        <div className="mb-6 mt-2 flex items-center gap-x-3 text-xs text-faint">
          <span className="tabular-nums">2026-10-29</span><span>edited 1h</span>
          <Tag name="travel" remove className="h-6 text-xs" />
          <span className="flex h-6 items-center gap-1 rounded-md px-1.5"><Plus className="size-3" />tag</span>
        </div>
        <div className="mb-6">
          <h2 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint"><ListTodo className="size-3.5" />Linked tasks</h2>
          <div className="mt-2 divide-y divide-line rounded-xl border border-line bg-card">
            {["Book Sintra train tickets", "Pack the carry-on"].map((t) => (
              <div key={t} className="flex h-10 items-center gap-2.5 px-3 text-sm"><Circle className="size-4 text-brand" /><span className="flex-1">{t}</span><ChevronRight className="size-4 text-faint" /></div>
            ))}
          </div>
        </div>
        <div className="text-[15px] leading-[1.6]">
          <p>Flights are booked. Apartment near the tram line, five nights.</p>
          <Mosaic pics={["dusk", "lake", "sun"]} className="mt-4 h-40 rounded-xl" />
          <h2 className="mt-7 text-lg font-bold tracking-tight">Where to eat</h2>
          <div className="mt-2 flex max-w-2xl items-center gap-3 rounded-xl border border-line bg-card p-2.5">
            <Picture kind="sun" className="size-16 shrink-0 rounded-lg border border-line" />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <p className="truncate text-sm font-semibold">Ten tascas worth the queue</p>
              <p className="text-[13px] leading-snug text-dim">Small family places, a short menu written on the wall, and the grilled fish of the day.</p>
              <p className="pt-0.5 text-xs text-faint">food-on-foot.example</p>
            </div>
            <span className="flex shrink-0 gap-1"><Tool icon={Copy} label="Copy" /><Tool icon={BookOpen} label="Read" /><Tool icon={Sparkles} label="Summarised" /></span>
          </div>
          <blockquote className="mt-3 rounded-r-md border-l-2 border-line bg-card py-1 pl-3 text-dim">
            <p><strong className="font-semibold text-fg">Summary</strong>: Ten small restaurants in Alfama and Mouraria; go before 19:30 or queue, cash at three of them.</p>
          </blockquote>
          <h2 className="mt-7 text-lg font-bold tracking-tight">Packing</h2>
          <div className="mt-3 space-y-1.5">
            {[["Passport and tickets", true], ["Comfortable walking shoes", false], ["Light rain jacket", false]].map(([t, on]) => (
              <div key={String(t)} className={on ? "flex items-center gap-2.5 text-dim line-through" : "flex items-center gap-2.5"}>
                <span className={on ? "flex size-4 items-center justify-center rounded-[3px] bg-brand text-bg" : "size-4 rounded-[3px] border border-faint"}>{on ? <Check className="size-3" strokeWidth={3} /> : null}</span>{t}
              </div>
            ))}
          </div>
          <div className="relative mt-6 w-full">
            <Picture kind="pdf" className="h-64 w-full rounded-lg border border-line" />
            <span className="absolute bottom-2 right-2 rounded-md bg-fg/75 px-2 py-0.5 text-xs font-medium text-bg">2 pages</span>
          </div>
          <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg border border-line bg-card px-2 py-0.5 text-sm"><FileText className="size-4 text-brand" />boarding-passes.pdf</span>
        </div>
      </div>
    </article>
  );
}

/** A note open on its own page, the whole window; the assistant's button in the corner. */
export function WebNote() {
  return <div className="relative flex h-full w-full bg-bg"><LisbonPage /><Fab /></div>;
}
