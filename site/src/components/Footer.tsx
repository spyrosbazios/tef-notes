import { GitBranch } from "lucide-react";
import { REPO } from "@/lib";
import { Brand } from "./ui";

export function Footer() {
  return (
    <footer className="border-t border-hair">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-5 py-12 sm:px-8 md:flex-row md:items-end md:justify-between">
        <div className="space-y-3">
          <Brand />
          <p className="max-w-xs text-[15px] text-dim">Made for one person's notes; yours too.</p>
        </div>
        <div className="space-y-3 md:text-right">
          <p className="text-[15px] text-dim">Open source, <a href={`${REPO}/blob/main/LICENSE`} className="underline decoration-line underline-offset-4 transition-colors hover:text-fg">AGPL licensed</a>, and self-hosted. Read it, run it, change it.</p>
          <a href={REPO} className="inline-flex items-center gap-2 rounded-full border border-line bg-glass px-4 py-2 text-sm font-semibold transition-colors hover:border-brand-line hover:bg-accent">
            <GitBranch className="size-4 text-brand" /> GitHub
          </a>
        </div>
      </div>
    </footer>
  );
}
