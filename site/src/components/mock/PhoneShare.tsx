import { Bot, ChevronLeft, FilePlus2, Link2, ListPlus, SquarePlus, type LucideIcon } from "lucide-react";
import { PhoneShell } from "./parts";

/** The choices as core/clip.ts `choices` words them: the server's pick first with JEV's chance, the other suggestions, then New note and New task. */
const WHERE: [LucideIcon, string, string?][] = [
  [ListPlus, "Append to Pasta e fagioli", "92%"],
  [ListPlus, "Append to Winter recipes", "6%"],
  [FilePlus2, "New note"],
  [SquarePlus, "New task"],
];

/** A page shared from another app (web/src/components/share-page.tsx, the installed app's share target): what was shared, a note of the
 *  owner's own, a summary if wanted, where it goes, and the assistant as the other way. */
export function PhoneShare() {
  return (
    <PhoneShell>
      <div className="flex h-12 items-center gap-1 border-b border-line px-2">
        <span className="flex h-8 items-center gap-1 px-2 text-sm font-medium"><ChevronLeft className="size-4" />Back</span>
        <span className="font-semibold">Shared with TEF Notes</span>
      </div>
      <div className="flex flex-col gap-4 px-4 pt-4">
        <div className="rounded-xl border border-line bg-card p-4">
          <div className="flex items-start gap-3">
            <Link2 className="mt-0.5 size-[18px] shrink-0 text-dim" />
            <div className="min-w-0 space-y-0.5"><p className="font-semibold">A weeknight bread that rises while you sleep</p><p className="text-[13px] text-dim">bakers-table.example/overnight-loaf</p></div>
          </div>
        </div>
        <div className="min-h-20 rounded-md border border-line px-3 py-2 text-[15px] text-faint">Add a note (optional)</div>
        <div className="flex items-center gap-3 px-1">
          <span className="flex h-5 w-9 items-center rounded-full bg-raised p-0.5"><span className="size-4 rounded-full bg-faint" /></span>
          <span className="text-[15px]">Add a summary</span>
        </div>
        <section className="space-y-1">
          <h2 className="px-2 text-xs font-semibold uppercase tracking-wide text-faint">Where should it go?</h2>
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-card">
            {WHERE.map(([I, t, h]) => (
              <li key={t} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                <I className="size-[18px] shrink-0 text-dim" />
                <span className="min-w-0 flex-1 truncate">{t}</span>{h ? <span className="text-[13px] text-dim">{h}</span> : null}
              </li>
            ))}
          </ul>
        </section>
        <span className="flex h-10 items-center justify-center gap-2 rounded-full bg-raised text-sm font-medium"><Bot className="size-4" />Ask the assistant to file it</span>
      </div>
    </PhoneShell>
  );
}
