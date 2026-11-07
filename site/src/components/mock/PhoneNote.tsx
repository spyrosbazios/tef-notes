import { Bold, Check, ChevronLeft, EllipsisVertical, Heading2, Italic, Link2, List, ListTodo, Plus, Undo2 } from "lucide-react";
import { BoxLine, PTag, PhoneShell, TaskRow } from "./parts";

const ROWS = [
  ["Clean gutters", "October, April", "Oct 2026"],
  ["Bleed radiators", "November", "pending"],
  ["Service boiler", "September", "Sep 2026"],
  ["Check smoke alarms", "Every 6 months", "May 2026"],
];

const cell = "border border-line px-2 py-1.5";

/** A note on the phone, always being edited: Done puts the keyboard away, the tasks linked to it sit under the title,
 *  and the format bar rides above the keys. */
export function PhoneNote() {
  return (
    <PhoneShell>
      <div className="flex h-full flex-col">
        <div className="flex h-14 items-center gap-1 px-2">
          <span className="flex size-12 items-center justify-center"><ChevronLeft className="size-[26px]" /></span>
          <span className="flex-1" />
          <span className="flex size-12 items-center justify-center text-dim"><EllipsisVertical className="size-[22px]" /></span>
          <span className="mx-1 flex h-9 items-center gap-1.5 rounded-full bg-brand px-3.5 text-[14px] font-semibold text-bg"><Check className="size-4" />Done</span>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden px-5 pt-2">
          <h1 className="text-[30px] font-extrabold leading-[1.1] tracking-tight">Garage and house maintenance</h1>
          <div className="mt-3 flex items-center gap-2.5 text-[13px] text-faint">
            <span className="font-mono">2026-10-18</span><span>edited 2m</span><PTag name="home" className="h-6 px-2.5 text-[13px]" />
            <span className="flex items-center gap-1"><Plus className="size-3.5" />tag</span>
          </div>
          <div className="-mx-5 mt-3">
            <TaskRow phone task={{ title: "Measure the spare room", when: "Today" }} />
            <TaskRow phone task={{ title: "Bleed the radiators", due: "Sunday" }} />
          </div>
          <div className="mt-3 text-[16px] leading-relaxed">
            <p>Seasonal things that are easy to forget.</p>
            <table className="mt-2 w-full border-collapse text-[13px]">
              <thead><tr className="bg-card text-left font-semibold">{["Task", "When", "Last done"].map((h) => <th key={h} className={cell}>{h}</th>)}</tr></thead>
              <tbody>{ROWS.map((r) => <tr key={r[0]}>{r.map((c) => <td key={c} className={cell}>{c}</td>)}</tr>)}</tbody>
            </table>
            <h2 className="mt-6 text-[22px] font-bold tracking-tight">Paint</h2>
            <p className="mt-2">Hallway wall: <strong className="font-bold">warm white</strong>, matte, 2.5 L covers it with two coats.</p>
            <div className="mt-3 space-y-3">
              <BoxLine phone on>Buy filler and sandpaper</BoxLine>
              <BoxLine phone>Mask the skirting</BoxLine>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center border-t border-line px-2 text-dim">
          {[Bold, Italic, ListTodo, List, Heading2, Link2, Undo2].map((I, i) => (
            <span key={i} className={i === 2 ? "flex h-12 flex-1 items-center justify-center rounded-full bg-raised text-brand" : "flex h-12 flex-1 items-center justify-center"}><I className="size-5" /></span>
          ))}
        </div>
      </div>
    </PhoneShell>
  );
}
