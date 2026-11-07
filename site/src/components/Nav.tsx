import { GitBranch } from "lucide-react";
import { REPO } from "@/lib";
import { Brand } from "./ui";

const LINKS = [
  ["Features", "#features"],
  ["Sneak peeks", "#peeks"],
  ["Clipper", "#clipper"],
  ["Your keys", "#keys"],
  ["Under the hood", "#fits"],
  ["Themes", "#themes"],
] as const;

export function Nav() {
  return (
    <header className="sticky top-0 z-50 border-b border-hair bg-bg/65 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
        <a href="#top" aria-label="TEF Notes, top of page"><Brand /></a>
        <nav aria-label="Sections" className="hidden items-center gap-1 md:flex">
          {LINKS.map(([label, href]) => (
            <a key={href} href={href} className="rounded-full px-4 py-2 text-[15px] text-dim transition-colors hover:text-fg">{label}</a>
          ))}
        </nav>
        <a href={REPO} className="flex h-10 items-center gap-2 rounded-full border border-line bg-glass px-4 text-sm font-semibold transition-colors hover:border-brand-line hover:bg-accent">
          <GitBranch className="size-4 text-brand" /> GitHub
        </a>
      </div>
    </header>
  );
}
