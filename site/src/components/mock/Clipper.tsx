import { ChevronDown, ChevronLeft, ChevronRight, ClipboardPlus, Ellipsis, FilePlus, Globe, ListPlus, ListTodo, Plus, Puzzle, RotateCw, Search, Star, X, type LucideIcon } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib";
import { Mark } from "../ui";
import { Picture } from "./parts";

/** The clipper's popup drawn under Chrome's toolbar, at its own size. */
export const CLIP = { w: 420, h: 760 } as const;
/** A whole Chrome window on the page being clipped, the popup hanging from its toolbar. */
export const PAGE = { w: 760, h: 830 } as const;

/** The choices as core/clip.ts `choices` words them: the pick first, "Append to" a note or "Add to task", each with
 *  JEV's percentage; New note; New task last. The glyphs are extension/src/icons.ts's. */
const CHOICES: [LucideIcon, string, string?][] = [
  [ListPlus, "Append to Autumn trip: Lisbon in five days", "64%"],
  [ListTodo, "Add to task Book a table for the last night", "21%"],
  [ListPlus, "Append to Where to eat, 2026", "9%"],
  [FilePlus, "New note"],
  [ClipboardPlus, "New task"],
];

/** The owner's own note on the clip. */
export const NOTE = "The three near the apartment";

/** A section as ui.css draws it: a card with its small capitals heading. */
const Section = ({ title, children, className }: { title?: string; children: ReactNode; className?: string }) => (
  <section className={cn("mt-2.5 rounded-[10px] border border-line bg-card px-3 pb-3 pt-2.5", className)}>
    {title ? <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.06em] text-dim">{title}</h2> : null}
    {children}
  </section>
);

const Field = ({ children, tall, typed }: { children: string; tall?: boolean; typed?: boolean }) => (
  <div className={cn("mt-2 rounded-lg border border-line bg-bg px-2.5 py-2 text-[14px] leading-[1.45]", tall && "min-h-[58px]", typed ? "text-fg" : "text-dim")}>
    {children}{typed ? <span className="ml-px inline-block h-4 w-px translate-y-[3px] bg-brand" /> : null}
  </div>
);

/** Chrome's toolbar: reload (with back and forward in a whole window, `nav`), the address, the star, and the extensions'
 *  corner with the clipper's mark, lit while its popup is open (`lit`). */
function Toolbar({ nav, lit = true, className }: { nav?: boolean; lit?: boolean; className?: string }) {
  return (
    <div className={cn("flex h-11 shrink-0 items-center gap-2 px-3", className)}>
      {nav ? <><span className="flex size-7 items-center justify-center text-dim"><ChevronLeft className="size-4" /></span><span className="flex size-7 items-center justify-center text-faint"><ChevronRight className="size-4" /></span></> : null}
      <span className="flex size-7 items-center justify-center text-faint"><RotateCw className="size-3.5" /></span>
      <div className="flex h-7 flex-1 items-center gap-2 rounded-full bg-bg px-3 text-[12px] text-dim"><Search className="size-3.5 text-faint" /><span className="truncate">food-on-foot.example/lisbon-tascas</span></div>
      <span className="flex size-7 items-center justify-center text-faint"><Star className="size-4" /></span>
      <span data-tap="clip" className={cn("flex size-7 items-center justify-center rounded-md", lit && "bg-accent")}><Mark className="h-4" /></span>
      <span className="flex size-7 items-center justify-center text-faint"><Puzzle className="size-4" /></span>
      <span className="flex size-7 items-center justify-center text-faint"><Ellipsis className="size-4" /></span>
    </div>
  );
}

/** The popup: a copy in structure of extension/src/popup.html and ui.css: the brand, the page, its tags (picked, and
 *  offered with their chance), the details (a title, a note, the summary box), and where to save. */
function Popup({ note, className, style }: { note: string; className?: string; style?: CSSProperties }) {
  return (
      <div style={style} className={cn("w-[380px] overflow-hidden rounded-lg border border-line bg-bg p-3.5 text-[14px] leading-[1.45] shadow-lift", className)}>
        <h1 className="mb-2.5 flex items-center gap-2 border-b border-line pb-2.5 text-[16px] font-extrabold tracking-[-0.02em]"><Mark className="h-5" />TEF Notes</h1>
        <Section className="mt-0 flex items-start gap-2.5 bg-raised px-3 py-2.5">
          <Globe className="mt-[3px] size-4 shrink-0 text-brand" />
          <div className="min-w-0"><p className="font-semibold">Ten tascas worth the queue</p><p className="text-[12px] text-dim">food-on-foot.example</p></div>
        </Section>
        <Section title="Tags">
          <div className="flex flex-wrap gap-1.5">
            {["travel", "food"].map((t) => (
              <span key={t} className="inline-flex items-center gap-1 rounded-full border border-brand bg-accent py-[3px] pl-2 pr-2.5 text-[12px] font-semibold"><X className="size-3 text-brand" />{t}</span>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-line py-[3px] pl-2 pr-2.5 text-[12px] text-dim"><Plus className="size-3" />lisbon <span className="text-[11px]">41%</span></span>
          </div>
          <div className="mt-2 flex h-[30px] items-center justify-between rounded-lg border border-line bg-raised px-2 text-[12px] text-dim">Add a tag…<ChevronDown className="size-3.5" /></div>
        </Section>
        <Section title="Details">
          <Field>Title for a new note or task (optional)</Field>
          <Field tall typed>{note}</Field>
          <p className="mt-2.5 flex items-center gap-2"><span className="flex size-[13px] items-center justify-center rounded-[3px] bg-brand text-bg"><svg viewBox="0 0 24 24" className="size-2.5" fill="none" stroke="currentColor" strokeWidth={4}><path d="M20 6 9 17l-5-5" /></svg></span>Add a summary</p>
        </Section>
        <Section title="Save to">
          <div className="flex flex-col gap-1.5">
            {CHOICES.map(([I, label, hint], i) => (
              <div key={label} data-tap={`save ${i}`} className={cn("flex h-[34px] items-center gap-2 rounded-lg border px-3.5", i === 0 ? "border-brand bg-accent font-semibold" : "border-line bg-raised")}>
                <I className={cn("size-4 shrink-0", i === 0 ? "text-brand" : "text-dim")} /><span className="flex-1 truncate">{label}</span>{hint ? <span className="text-dim">{hint}</span> : null}
              </div>
            ))}
          </div>
        </Section>
      </div>
  );
}

/** A strip of Chrome, the extensions' corner with the mark lit, and the popup hanging from it. `note` is the owner's note
 *  as far as it has been typed. */
export function ClipperPopup({ note = NOTE }: { note?: string }) {
  return <div className="flex h-full w-full flex-col bg-raised"><Toolbar /><Popup note={note} className="relative ml-auto mr-3" /></div>;
}

/** The page being clipped, in a whole Chrome window: the tab, the toolbar, the article, and the popup hanging from the
 *  clipper's mark. `open` is how far the popup has opened (0: closed, the mark unlit; 1: open). */
export function ClipperPage({ note = NOTE, open = 1 }: { note?: string; open?: number }) {
  return (
    <div className="relative flex h-full w-full flex-col bg-raised">
      <div className="flex h-10 shrink-0 items-end gap-2 px-3">
        <span className="flex gap-1.5 self-center pr-2">{["bg-down/80", "bg-warn/80", "bg-up/80"].map((c) => <span key={c} className={cn("size-2.5 rounded-full", c)} />)}</span>
        <span className="flex h-8 w-64 items-center gap-2 rounded-t-lg bg-card px-3 text-[12px]"><Globe className="size-3.5 shrink-0 text-dim" /><span className="min-w-0 flex-1 truncate">Ten tascas worth the queue</span><X className="size-3 shrink-0 text-faint" /></span>
        <span className="flex size-7 items-center justify-center self-center text-faint"><Plus className="size-4" /></span>
      </div>
      <Toolbar nav lit={open > 0} className="bg-card" />
      <article className="min-h-0 flex-1 overflow-hidden border-t border-line bg-bg px-10 pt-7">
        <p className="flex items-center gap-4 text-[12px] font-semibold uppercase tracking-[0.14em] text-brand">Food on foot<span className="font-normal normal-case tracking-normal text-faint">Lisbon</span><span className="font-normal normal-case tracking-normal text-faint">Porto</span><span className="font-normal normal-case tracking-normal text-faint">Guides</span></p>
        <h1 className="mt-5 max-w-[300px] text-[30px] font-extrabold leading-[1.1] tracking-tight">Ten tascas worth the queue</h1>
        <p className="mt-2 text-[12px] text-faint">A walking guide · 6 min read</p>
        <Picture kind="sun" className="mt-5 h-44 w-[300px] rounded-xl border border-line" />
        <div className="mt-5 max-w-[300px] space-y-3 text-[14px] leading-relaxed text-dim">
          <p>Small family places, a short menu written on the wall, and the grilled fish of the day.</p>
          <p>Go before 19:30 or join the queue. Three of them take cash only, so bring some.</p>
          <p>Start in Alfama and walk downhill: the first three are within ten minutes of each other.</p>
        </div>
      </article>
      {open > 0 ? <Popup note={note} className="absolute right-3 top-[84px]" style={{ opacity: open, transform: `scale(${0.96 + open * 0.04})`, transformOrigin: "100% 0" }} /> : null}
    </div>
  );
}
