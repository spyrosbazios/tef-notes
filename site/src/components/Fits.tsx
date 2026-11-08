import { Boxes, Container, Database, Globe, Puzzle, Smartphone, SquareTerminal, Zap, type LucideIcon } from "lucide-react";
import { Heading, Reveal } from "./ui";

const CLIENTS: [LucideIcon, string, string][] = [
  [Smartphone, "Phone", "Installed from Chrome, works offline"],
  [Globe, "Web", "Served by the server"],
  [SquareTerminal, "CLI", "Notes and tasks from the shell"],
  [Puzzle, "Extension", "Chrome clipper"],
];

const STACK: [LucideIcon, string, string][] = [
  [Database, "PocketBase", "One binary, SQLite inside. Hooks hold the write contract; migrations are the schema."],
  [Zap, "The agent", "A bun sidecar that streams the chat. MCP for other agents, if you want it."],
  [Boxes, "One core", "Note format, merge, task rules and palettes, imported by every client."],
  [Container, "One compose", "Server, web app and extension in one build. Your data is one directory."],
];

/** Four ways in converge on one server. The wires are one SVG stretched to the row (non-scaling strokes), the flow a
 *  dash animation; below md the clients stack in a grid and one short wire stands in. */
export function Fits() {
  const xs = [11.8, 37.3, 62.7, 88.2];
  return (
    <section id="fits" className="relative mx-auto max-w-6xl px-5 py-24 sm:px-8 md:py-32">
      <Heading eyebrow="Under the hood" title="Four ways in. One notebook underneath." />

      <Reveal className="mx-auto mt-16 max-w-4xl">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
          {CLIENTS.map(([Icon, name, sub]) => (
            <div key={name} className="rounded-card border border-line bg-glass p-5 text-center backdrop-blur">
              <div className="mx-auto flex size-11 items-center justify-center rounded-xl border border-brand-line/50 bg-accent text-brand"><Icon className="size-[22px]" strokeWidth={1.9} /></div>
              <p className="mt-4 font-bold">{name}</p>
              <p className="mt-1 text-[13px] leading-snug text-dim">{sub}</p>
            </div>
          ))}
        </div>

        <svg className="hidden h-24 w-full md:block" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
          {xs.map((x) => (
            <g key={x} fill="none" vectorEffect="non-scaling-stroke">
              <path d={`M${x} 0 V12 Q${x} 20 ${(x + 50) / 2} 20 T50 40`} stroke="var(--tf-line)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
              <path d={`M${x} 0 V12 Q${x} 20 ${(x + 50) / 2} 20 T50 40`} stroke="var(--tf-brand)" strokeWidth="1.5" strokeDasharray="4 20" strokeLinecap="round" vectorEffect="non-scaling-stroke" className="animate-flow" />
            </g>
          ))}
        </svg>
        <div className="mx-auto h-12 w-px bg-gradient-to-b from-line to-brand md:hidden" aria-hidden="true" />

        <div className="relative rounded-[1.75rem] border border-brand-line/60 bg-card p-6 shadow-[0_0_80px_-30px_var(--tf-glow)] sm:p-8">
          <div className="flex flex-col items-center gap-1 text-center">
            <p className="text-2xl font-extrabold tracking-tight">One PocketBase server</p>
            <p className="text-[15px] text-dim">On a machine you own. Reached only over your private network.</p>
          </div>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {STACK.map(([Icon, name, text]) => (
              <div key={name} className="flex items-start gap-3.5 rounded-xl border border-line bg-bg/60 p-4">
                <Icon className="mt-0.5 size-5 shrink-0 text-brand" strokeWidth={1.9} />
                <div><p className="font-bold">{name}</p><p className="mt-1 text-[14px] leading-relaxed text-dim">{text}</p></div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 flex items-center justify-center gap-3 text-[13px] text-faint">
          <span className="h-px w-12 bg-line" /> A private network in front. No accounts, no public port. <span className="h-px w-12 bg-line" />
        </div>
      </Reveal>
    </section>
  );
}
