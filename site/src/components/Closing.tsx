import { ArrowRight, GitBranch } from "lucide-react";
import { REPO } from "@/lib";
import { Reveal } from "./ui";

export function Closing() {
  return (
    <section id="get" className="relative overflow-hidden">
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[28rem] w-[56rem] max-w-[150vw] -translate-x-1/2 -translate-y-1/2 rounded-full bg-glow opacity-40 blur-[130px]" aria-hidden="true" />
      <Reveal className="relative mx-auto max-w-3xl px-5 py-28 text-center sm:px-8 md:py-40">
        <h2 className="text-[clamp(2.25rem,6vw,4.25rem)] font-extrabold leading-[1.02] tracking-[-0.04em] text-balance">Yours in a couple of commands.</h2>
        <p className="mx-auto mt-5 max-w-xl text-lg text-dim text-pretty">Start the server on any machine with Docker, set its address in .env, then open it in a browser, install it on your phone from Chrome and point the terminal at it.</p>
        <div className="mx-auto mt-10 max-w-xl overflow-hidden rounded-2xl border border-line bg-card text-left shadow-lift">
          <div className="flex items-center gap-1.5 border-b border-line bg-raised/70 px-4 py-2.5" aria-hidden="true">
            <span className="size-2.5 rounded-full bg-line" /><span className="size-2.5 rounded-full bg-line" /><span className="size-2.5 rounded-full bg-line" />
          </div>
          <pre className="overflow-x-auto p-5 font-mono text-[13.5px] leading-7 text-fg"><code>
            <span className="text-faint">$ </span>git clone {REPO}.git tefnotes{"\n"}
            <span className="text-faint">$ </span>cd tefnotes/server && cp .env.example .env{"\n"}
            <span className="text-faint">$ </span>docker compose up -d --build
          </code></pre>
        </div>
        <p className="mx-auto mt-6 max-w-xl text-[15px] text-faint text-pretty">On the phone, open the server's HTTPS address in Chrome and choose Install app. A private HTTPS address is what lets it install: Tailscale Serve gives you one.</p>
        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a href={`${REPO}#get-started`} className="group flex h-12 w-full items-center justify-center gap-2 rounded-full bg-brand px-7 text-[15px] font-bold text-bg shadow-[0_0_44px_-6px_var(--tf-glow)] transition-transform hover:scale-[1.03] sm:w-auto">
            Read the guide <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </a>
          <a href={REPO} className="flex h-12 w-full items-center justify-center gap-2 rounded-full border border-line bg-glass px-7 text-[15px] font-semibold backdrop-blur transition-colors hover:border-brand-line hover:bg-accent sm:w-auto">
            <GitBranch className="size-4 text-brand" /> See the source
          </a>
        </div>
      </Reveal>
    </section>
  );
}
