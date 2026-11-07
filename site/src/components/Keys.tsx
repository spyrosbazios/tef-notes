import { Bot, MessageSquareText, Search, Tags, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib";
import { ExaMark, PROVIDERS, ProviderMark, TypeSafeMark } from "./logos";
import { Heading, Reveal } from "./ui";

/** One key: whose it is, what it is for, the file it lives in and what it powers. */
type Key = { mark: ReactNode; name: string; by: string; does: string; file: string; powers: [LucideIcon, string][]; extra?: ReactNode };

const KEYS: Key[] = [
  {
    mark: <Bot className="size-9" strokeWidth={1.6} />, name: "A writing model", by: "your pick of seven", does: "Writes: the chat, a clip's note, summaries.",
    file: "keys/<provider>/api-key",
    powers: [[MessageSquareText, "The assistant"], [Tags, "Summaries and tag descriptions"]],
    extra: (
      <div className="mt-4 flex flex-wrap gap-1.5">
        {PROVIDERS.map(([name, icon], i) => (
          <span key={name} className={cn("inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium", i === 0 ? "border-brand bg-accent text-fg" : "border-line text-dim")}>
            {icon ? <ProviderMark icon={icon} className="size-3.5" /> : null}{name}
          </span>
        ))}
      </div>
    ),
  },
  {
    mark: <TypeSafeMark className="h-10" />, name: "JEV", by: "TypeSafe AI", does: "Decides: a typed question in, a probability out. Never prose.",
    file: "keys/typesafe/api-key",
    powers: [[Tags, "Auto-tagging"], [Search, "Where a clip belongs"]],
    extra: (
      <div className="mt-4 rounded-xl border border-line bg-bg/60 p-3">
        <p className="text-[13px] leading-snug">Does this page belong in <strong className="font-semibold">Autumn trip: Lisbon</strong>?</p>
        <div className="mt-2.5 flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-raised"><div className="h-full w-[64%] rounded-full bg-brand animate-fill" /></div>
          <span className="text-sm font-bold tabular-nums text-brand">0.64</span>
        </div>
      </div>
    ),
  },
  {
    mark: <ExaMark className="h-9" />, name: "Exa", by: "exa.ai", does: "Searches: the web, for the assistant only.",
    file: "keys/exa/api-key",
    powers: [[Search, "Web search"], [MessageSquareText, "Read a page into the chat"]],
    extra: <p className="mt-4 text-[13px] leading-snug text-faint">A turn that read the web cannot write a note on its own, and its memory stays closed.</p>,
  },
];

/** The file the key lives in, and what it powers. */
function Slot({ k }: { k: Key }) {
  return (
    <div>
      <code className="block rounded-xl border border-line bg-bg/60 px-3 py-2.5 text-[12px] text-dim">{k.file}</code>
      <ul className="mt-3 space-y-1.5">
        {k.powers.map(([I, label]) => <li key={label} className="flex items-center gap-2.5 text-[14px]"><I className="size-4 text-brand" />{label}</li>)}
      </ul>
    </div>
  );
}

export function Keys() {
  return (
    <section id="keys" className="relative border-y border-hair bg-card/40 py-24 md:py-32">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <Heading eyebrow="Bring your own keys" title="Three keys. Each one optional.">
          A key is one file on your server, and nowhere else.
        </Heading>
        <div className="mt-16 grid gap-4 lg:grid-cols-3">
          {KEYS.map((k, i) => (
            <Reveal key={k.name} delay={i * 90} className="h-full">
              <div className="flex h-full flex-col rounded-card border border-line bg-glass p-6 backdrop-blur">
                <div className="flex items-center gap-4">
                  <div className="flex size-16 shrink-0 items-center justify-center rounded-2xl border border-line bg-bg text-fg">{k.mark}</div>
                  <div><h3 className="text-xl font-bold leading-tight tracking-tight">{k.name}</h3><p className="text-[13px] text-faint">{k.by}</p></div>
                </div>
                <p className="mt-5 text-[15px] leading-snug text-dim">{k.does}</p>
                {k.extra}
                <div className="mt-auto pt-6"><Slot k={k} /></div>
              </div>
            </Reveal>
          ))}
        </div>
        <Reveal className="mt-10 text-center text-[14px] text-faint">
          Whatever a key sends leaves your server: note text, the photos the tagger looks at, the pages you clip. That is the only way out.
        </Reveal>
      </div>
    </section>
  );
}
