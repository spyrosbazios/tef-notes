import { Bot, ChevronLeft, FilePlus2, Link2, ListPlus, SquarePlus, type LucideIcon } from "lucide-react";
import { PhoneShell } from "./parts";

/** The choices as core/clip.ts `choices` words them, with mobile/src/app/share.tsx's icons: the server's pick first with
 *  JEV's chance, the other suggestions, then New note and New task. */
const WHERE: [LucideIcon, string, string?][] = [
  [ListPlus, "Append to Pasta e fagioli", "92%"],
  [ListPlus, "Append to Winter recipes", "6%"],
  [FilePlus2, "New note"],
  [SquarePlus, "New task"],
];

/** A page shared from another app (mobile/src/app/share.tsx): what was shared, a note of the owner's own, a summary if
 *  wanted, where it goes, and the agent as the other way. */
export function PhoneShare() {
  return (
    <PhoneShell>
      <div className="flex h-14 items-center gap-1 px-2">
        <span className="flex size-12 items-center justify-center"><ChevronLeft className="size-[26px]" /></span>
        <span className="text-[18px] font-semibold">Shared with TEF Notes</span>
      </div>
      <div className="flex flex-col gap-4 px-4 pt-2">
        <div className="rounded-2xl bg-card">
          <p className="px-4 pt-3.5 text-[12px] font-semibold text-dim">Shared</p>
          <div className="flex items-start gap-3 p-4 pt-2.5">
            <Link2 className="mt-0.5 size-5 shrink-0 text-brand" />
            <div className="min-w-0"><p className="text-[15px] font-semibold">A weeknight bread that rises while you sleep</p><p className="text-[13px] leading-snug text-dim">bakers-table.example/overnight-loaf</p></div>
          </div>
        </div>
        <div className="min-h-24 rounded-xl bg-muted px-4 py-3 text-[15px] text-dim">Add a note (optional)</div>
        <div className="flex items-center gap-3 px-1">
          <span className="size-[22px] rounded-md border-2 border-faint" />
          <span className="text-[15px]">Add a summary</span>
        </div>
        <div>
          <p className="px-4 pb-2 text-[12px] font-semibold text-dim">Where should it go?</p>
          <div className="overflow-hidden rounded-2xl bg-card">
            {WHERE.map(([I, t, h], i) => (
              <div key={t}>
                {i ? <div className="ml-4 h-px bg-line" /> : null}
                <div className="flex min-h-14 items-center gap-3 px-4 py-2">
                  <span className="flex size-9 items-center justify-center rounded-xl bg-accent text-brand"><I className="size-[18px]" /></span>
                  <span className="flex-1 truncate text-[15px] font-medium">{t}</span>{h ? <span className="text-[13px] text-dim">{h}</span> : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-0 px-4 pb-3 pt-3">
        <span className="flex min-h-14 items-center justify-center gap-2 rounded-full bg-raised text-[17px] font-semibold"><Bot className="size-5" />Let the agent file it</span>
      </div>
    </PhoneShell>
  );
}
