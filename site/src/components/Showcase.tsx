import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { THEMES, withAccent } from "@/core/theme";
import { cn } from "@/lib";
import { PhoneAsk } from "./mock/PhoneAsk";
import { PhoneHome } from "./mock/PhoneHome";
import { PhoneSearch } from "./mock/PhoneSearch";
import { PhoneShare } from "./mock/PhoneShare";
import { PhoneTasks } from "./mock/PhoneTasks";
import { AskDock, DOCK } from "./mock/WebAsk";
import { LisbonPage } from "./mock/WebNote";
import { WebTasks } from "./mock/WebTasks";
import { Heading, Peek, PhoneFrame, Reveal, scoped } from "./ui";

type Row = { eyebrow: string; title: string; text: string; points: string[]; caption: string; visual: ReactNode; wide?: boolean };

/** A pair of phones side by side, the second a little lower. */
const Pair = ({ a, b }: { a: ReactNode; b: ReactNode }) => (
  <div className="relative mx-auto flex max-w-[24rem] items-start justify-center gap-4 pb-6 sm:max-w-md">
    <div className="w-[52%]">{a}</div>
    <div className="mt-12 w-[52%] sm:mt-16">{b}</div>
  </div>
);

/** One screen per row, and only the part of it the row is about: a detail at a size that reads, never a whole
 *  window and a whole phone shrunk side by side. */
const ROWS: Row[] = [
  {
    eyebrow: "Notes",
    title: "Write it down. Everything stays with it.",
    text: "A note is one markdown page. Photos, PDFs, drawings and links live inside it, and the tasks about it sit right under the title.",
    points: ["Links as cards, with Read and an AI summary", "A PDF's first page in place; its text selectable", "Linked tasks under the title, on every screen"],
    caption: "The top of a note on the web: its tasks, a photo strip, a link card and its summary.",
    visual: (
      <Peek label="The top of a travel note on the web: title, tags, two linked tasks, three photos, a link card with its summary"
        crop={{ x: 312, y: 56, w: 816, h: 640 }} narrow={{ x: 352, y: 56, w: 600, h: 560 }} fade="both"><div className="flex h-full w-full bg-bg"><LisbonPage /></div></Peek>
    ),
  },
  {
    eyebrow: "Tasks",
    title: "Your day, planned. Your server, keeping it.",
    text: "Your day in Today and This Evening, the rest waiting in Upcoming, and a month that shows at a glance which days are full. Repeats keep their rhythm.",
    points: ["Checklists, reminders and deadlines", "Repeats: every Friday, every two weeks, a month's last day", "Tags as you type, and the notes a task is about"],
    caption: "Today on the web, with a task open beside it.",
    wide: true,
    visual: <Peek label="Today on the web: the list on the left, the open task with its checklist and fields on the right" crop={{ x: 240, y: 0, w: 1080, h: 600 }} narrow={{ x: 240, y: 0, w: 440, h: 560 }} fade="bottom"><WebTasks /></Peek>,
  },
  {
    eyebrow: "Ask",
    title: "An assistant that knows what you are looking at.",
    text: "Open it beside any page. It reads the note you have open, searches the rest by meaning, and proposes changes as cards you approve or turn down.",
    points: ["Finds notes by what they mean, PDFs too", "Adds and edits tasks in one card", "Takes a photo or a PDF with your question, and dictation"],
    caption: "The assistant's dock on the web, proposing two tasks. On the phone it is the Ask tab.",
    visual: <Peek label="The assistant's dock: a question, what it read, and a card proposing two tasks with Add them and Not now" size={DOCK} className="mx-auto max-w-sm"><AskDock /></Peek>,
  },
  {
    eyebrow: "Lenses",
    title: "One app for work and home. Never both at once.",
    text: "A lens is a set of tags, and the tags it hides. Turn one on and Home, the task lists, search and the assistant all keep to it, in the lens's own colour.",
    points: ["Picked from the mark on the phone, the rail on the web", "What you make inherits the lens's first tag", "Set up once; the lens you turn on follows you to every device"],
    caption: "The same Home through the Home lens and the Work lens.",
    visual: (
      <Pair
        a={<PhoneFrame label="The phone's Home through the Home lens"><PhoneHome lens="Home" /></PhoneFrame>}
        b={<div style={scoped(withAccent(THEMES.oled, "teal"))}><PhoneFrame label="The phone's Home through the Work lens, in teal"><PhoneHome lens="Work" /></PhoneFrame></div>}
      />
    ),
  },
  {
    eyebrow: "Install",
    title: "The same app, in your pocket.",
    text: "Open your server in Chrome on Android and choose Install app. It is the web app laid out for a thumb, with an animated interface that follows your device's reduced-motion setting.",
    points: ["Bottom tabs for Home, Tasks, Ask and Settings, in the order you like, and a strip of days", "Swipe a task for When or Delete; tick it, with a moment to Undo", "Task reminders as notifications, no store and no APK"],
    caption: "Tasks and Ask in the installed app.",
    visual: <Pair a={<PhoneFrame label="The Tasks tab on Today: the lists as tabs, the day's tasks and This Evening"><PhoneTasks /></PhoneFrame>} b={<PhoneFrame label="The Ask tab: a chat with a note the assistant found and a task it points to"><PhoneAsk /></PhoneFrame>} />,
  },
  {
    eyebrow: "Search and share",
    title: "Find anything. File anything.",
    text: "Search drops down from Home and works offline, forgiving accents; when it finds nothing, the assistant looks for what you meant. Share a page, a photo or a screenshot from any app and the server suggests where it goes.",
    points: ["A #tag in the search narrows notes and tasks alike", "Offline edits are kept and merged when you reconnect", "A link, text, photos or a PDF shared from any app"],
    caption: "Search over Home, and a page shared from the browser.",
    visual: <Pair a={<PhoneFrame label="Search on the phone, notes and tasks as you type"><PhoneSearch /></PhoneFrame>} b={<PhoneFrame label="A shared page, with the server's suggestions of where it goes"><PhoneShare /></PhoneFrame>} />,
  },
];

export function Showcase() {
  return (
    <section id="peeks" className="relative border-y border-hair bg-card/40 py-24 md:py-32">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <Heading eyebrow="Sneak peeks" title="A calm place to think, and to get things done." />
        <div className="mt-20 space-y-24 md:mt-28 md:space-y-36">
          {ROWS.map((r, i) => (
            <div key={r.title} className="grid items-center gap-12 lg:grid-cols-12 lg:gap-16">
              <Reveal className={cn(r.wide ? "lg:col-span-4" : "lg:col-span-5", i % 2 === 1 && "lg:order-2")}>
                <p className="text-[13px] font-semibold uppercase tracking-[0.18em] text-brand">{r.eyebrow}</p>
                <h3 className="mt-4 text-[clamp(1.75rem,3.4vw,2.6rem)] font-extrabold leading-[1.08] tracking-[-0.03em] text-balance">{r.title}</h3>
                <p className="mt-5 text-lg leading-relaxed text-dim text-pretty">{r.text}</p>
                <ul className="mt-7 space-y-3">
                  {r.points.map((p) => (
                    <li key={p} className="flex items-start gap-3 text-[15.5px]">
                      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-accent text-brand"><Check className="size-3" strokeWidth={3} /></span>
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </Reveal>
              <Reveal delay={100} className={cn(r.wide ? "lg:col-span-8" : "lg:col-span-7", i % 2 === 1 && "lg:order-1")}>
                <figure>
                  {r.visual}
                  <figcaption className="mt-5 text-center text-sm text-faint">{r.caption}</figcaption>
                </figure>
              </Reveal>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
