import { ChevronDown, ClipboardPlus, Ellipsis, FilePlus, Globe, ListPlus, ListTodo, Plus, Puzzle, RotateCw, Search, Star, X, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib";
import { Mark } from "../ui";

/** The clipper's popup drawn under Chrome's toolbar, at its own size. */
export const CLIP = { w: 420, h: 760 } as const;

/** The choices as core/clip.ts `choices` words them: the pick first, "Append to" a note or "Add to task", each with
 *  JEV's percentage; New note; New task last. The glyphs are extension/src/icons.ts's. */
const CHOICES: [LucideIcon, string, string?][] = [
  [ListPlus, "Append to Autumn trip: Lisbon in five days", "64%"],
  [ListTodo, "Add to task Book a table for the last night", "21%"],
  [ListPlus, "Append to Where to eat, 2026", "9%"],
  [FilePlus, "New note"],
  [ClipboardPlus, "New task"],
];

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

/** A strip of Chrome: the address bar, the extensions' corner with the mark lit, and the popup hanging from it. The
 *  popup is a copy in structure of extension/src/popup.html and ui.css: the brand, the page, its tags (picked, and
 *  offered with their chance), the details (a title, a note, the summary box), and where to save. */
export function ClipperPopup() {
  return (
    <div className="flex h-full w-full flex-col bg-raised">
      <div className="flex h-11 shrink-0 items-center gap-2 px-3">
        <span className="flex size-7 items-center justify-center text-faint"><RotateCw className="size-3.5" /></span>
        <div className="flex h-7 flex-1 items-center gap-2 rounded-full bg-bg px-3 text-[12px] text-dim"><Search className="size-3.5 text-faint" /><span className="truncate">food-on-foot.example/lisbon-tascas</span></div>
        <span className="flex size-7 items-center justify-center text-faint"><Star className="size-4" /></span>
        <span className="flex size-7 items-center justify-center rounded-md bg-accent"><Mark className="h-4" /></span>
        <span className="flex size-7 items-center justify-center text-faint"><Puzzle className="size-4" /></span>
        <span className="flex size-7 items-center justify-center text-faint"><Ellipsis className="size-4" /></span>
      </div>
      <div className="relative ml-auto mr-3 w-[380px] overflow-hidden rounded-lg border border-line bg-bg p-3.5 text-[14px] leading-[1.45] shadow-lift">
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
          <Field tall typed>The three near the apartment</Field>
          <p className="mt-2.5 flex items-center gap-2"><span className="flex size-[13px] items-center justify-center rounded-[3px] bg-brand text-bg"><svg viewBox="0 0 24 24" className="size-2.5" fill="none" stroke="currentColor" strokeWidth={4}><path d="M20 6 9 17l-5-5" /></svg></span>Add a summary</p>
        </Section>
        <Section title="Save to">
          <div className="flex flex-col gap-1.5">
            {CHOICES.map(([I, label, hint], i) => (
              <div key={label} className={cn("flex h-[34px] items-center gap-2 rounded-lg border px-3.5", i === 0 ? "border-brand bg-accent font-semibold" : "border-line bg-raised")}>
                <I className={cn("size-4 shrink-0", i === 0 ? "text-brand" : "text-dim")} /><span className="flex-1 truncate">{label}</span>{hint ? <span className="text-dim">{hint}</span> : null}
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}
