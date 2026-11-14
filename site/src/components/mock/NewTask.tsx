import { Bell, Calendar, Flag, Mic, Plus, Repeat, Tag as TagIcon, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib";
import { Pill, Tag } from "./parts";
import { PhoneHome } from "./PhoneHome";

/** The task the demo adds, and the tags the server gives it while it is typed. */
export const TASK = "Buy stock for the soup";
export const GUESSED = ["cooking", "errands"];

const Row = ({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) => (
  <div className="flex min-h-9 items-center gap-3 text-sm text-dim"><Icon className="size-4 shrink-0" /><span className="w-20 shrink-0">{label}</span>{children}</div>
);

/** New task on the phone (web/src/components/quick-add.tsx below `md`, in form-sheet.tsx's bottom sheet), over Home: the
 *  title and notes, each with its mic, the task's fields, and Cancel beside the button that adds it. The tags are the
 *  server's guess, made while the title is typed (hooks/tags.ts useGuessedTags). `title` is the title as far as it has
 *  been typed, `tags` the guessed tags that have landed. */
export function PhoneNewTask({ title = TASK, tags = GUESSED }: { title?: string; tags?: string[] }) {
  return (
    <PhoneHome over={
      <div className="absolute inset-0 z-10 flex flex-col justify-end bg-scrim">
        <div className="rounded-t-2xl border-t border-line bg-bg">
          <span className="mx-auto mt-3 block h-1.5 w-12 rounded-full bg-muted" />
          <p className="px-4 pb-2 pt-3 text-center text-[15px] font-semibold">New task</p>
          <div className="space-y-4 px-4 py-3">
            <div className="flex h-11 items-center gap-2 rounded-md border border-line pl-3 pr-2 text-base">
              {title
                ? <span className="min-w-0 flex-1 truncate">{title}<span className="ml-px inline-block h-5 w-0.5 bg-brand align-[-4px]" /></span>
                : <span className="min-w-0 flex-1 truncate text-faint">What needs doing? Type or tap the mic</span>}
              <span className="flex size-8 shrink-0 items-center justify-center text-dim"><Mic className="size-4" /></span>
            </div>
            <div className="flex min-h-20 items-start gap-2 rounded-md border border-line py-1 pl-3 pr-2 text-sm text-faint">
              <span className="flex-1 py-1">Notes</span>
              <span className="flex size-8 shrink-0 items-center justify-center text-dim"><Mic className="size-4" /></span>
            </div>
            <div className="space-y-0.5 border-t border-line pt-3">
              <Row icon={Calendar} label="When"><Pill none>No date</Pill></Row>
              <Row icon={Flag} label="Deadline"><Pill none>None</Pill></Row>
              <Row icon={Repeat} label="Repeat"><Pill none>Never</Pill></Row>
              <Row icon={Bell} label="Reminder"><Pill none>None</Pill></Row>
              <Row icon={TagIcon} label="Tags">
                <span className="flex items-center gap-2">
                  {tags.map((t) => <Tag key={t} name={t} remove className="h-6 text-xs" />)}
                  <span className="flex h-6 items-center gap-1 text-xs text-faint"><Plus className="size-3" />tag</span>
                </span>
              </Row>
            </div>
          </div>
          <div className="grid auto-cols-fr grid-flow-col gap-2 border-t border-line px-4 pb-5 pt-3 text-sm font-medium">
            <span className="flex h-9 items-center justify-center rounded-full">Cancel</span>
            <span data-tap="add" className={cn("flex h-9 items-center justify-center rounded-full bg-brand text-bg", !title && "opacity-50")}>Add to Inbox</span>
          </div>
        </div>
      </div>
    } />
  );
}
