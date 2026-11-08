import { ArrowRight, GitBranch, Globe, Smartphone, SquareTerminal, Sparkles, Puzzle } from "lucide-react";
import { REPO } from "@/lib";
import { PhoneHome } from "./mock/PhoneHome";
import { WebHome } from "./mock/WebHome";
import { BrowserFrame, PhoneFrame, Reveal, ScrollStage } from "./ui";

const SURFACES = [
  [Smartphone, "Phone"],
  [Globe, "Web"],
  [Puzzle, "Chrome"],
  [SquareTerminal, "Terminal"],
] as const;

export function Hero() {
  return (
    <section id="top" className="relative overflow-hidden pb-24 pt-16 sm:pt-24 md:pb-36">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[44rem] bg-grid" aria-hidden="true" />
      <div className="pointer-events-none absolute left-1/2 top-[-18rem] h-[40rem] w-[70rem] max-w-[160vw] -translate-x-1/2 rounded-full bg-glow opacity-60 blur-[140px]" aria-hidden="true" />

      <div className="relative mx-auto max-w-6xl px-5 sm:px-8">
        <ScrollStage title={
          <Reveal className="mx-auto max-w-4xl text-center">
            <p className="mx-auto inline-flex items-center gap-2 rounded-full border border-line bg-glass px-3.5 py-1.5 text-[13px] text-dim backdrop-blur">
              <Sparkles className="size-3.5 text-brand" /> Notes, tasks and an assistant, in one place
            </p>
            <h1 className="mt-8 text-[clamp(2.9rem,8.4vw,6.4rem)] font-extrabold leading-[0.96] tracking-[-0.045em] text-balance">
              One notebook for your{" "}
              <span className="bg-gradient-to-b from-fg via-brand to-brand bg-clip-text text-transparent">whole life.</span>
            </h1>
            <p className="mx-auto mt-7 max-w-2xl text-lg leading-relaxed text-dim text-pretty sm:text-xl">
              TEF Notes keeps your notes, your to-dos and an assistant that has read them both, on a server you own.
              One polished app for the laptop and, installed from Chrome, the phone. Nothing to sign up for, nothing that leaves your network.
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a href="#get" className="group flex h-12 w-full items-center justify-center gap-2 rounded-full bg-brand px-7 text-[15px] font-bold text-bg shadow-[0_0_44px_-6px_var(--tf-glow)] transition-transform hover:scale-[1.03] sm:w-auto">
                Run your own <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </a>
              <a href={REPO} className="flex h-12 w-full items-center justify-center gap-2 rounded-full border border-line bg-glass px-7 text-[15px] font-semibold backdrop-blur transition-colors hover:border-brand-line hover:bg-accent sm:w-auto">
                <GitBranch className="size-4 text-brand" /> See the source
              </a>
            </div>
            <ul className="mt-9 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-faint">
              {SURFACES.map(([Icon, label]) => (
                <li key={label} className="flex items-center gap-2"><Icon className="size-4" /> {label}</li>
              ))}
            </ul>
          </Reveal>
        }>
          <Reveal delay={150} className="relative mx-auto mt-16 max-w-5xl sm:mt-20">
            <div className="pointer-events-none absolute -inset-x-10 -bottom-10 -top-6 -z-10 rounded-[3rem] bg-glow-soft blur-3xl" aria-hidden="true" />
            <BrowserFrame label="TEF Notes on the web: Home, with the day's tasks, the month ahead and every note" className="w-[92%] sm:w-[90%]"><WebHome /></BrowserFrame>
            <PhoneFrame label="TEF Notes on the phone: Home, with the days strip, the day's tasks and the notes"
              className="absolute -bottom-8 right-0 w-[27%] min-w-[96px] max-w-[250px] sm:-bottom-12 md:right-[-1%] animate-float"><PhoneHome /></PhoneFrame>
          </Reveal>
        </ScrollStage>
      </div>
    </section>
  );
}
