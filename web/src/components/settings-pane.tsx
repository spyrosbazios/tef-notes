// Settings: the shell. A window lists the sections beside the page; below `md` the list is the page and a section opens over it
// (`?section=`), as the phone's Settings tab does. Each section is a file of its own in `settings/`: appearance, layout (each
// layout's own preferences), notes (the assistant actions, and per layout the format tools and a note's header), agent (model, which writes ask first, memory),
// voice, reminders (Web Push on this device), tags (definitions, kept on the server), import and export, and maintenance (the
// server, the offline copy, the version), all drawn from settings/kit.tsx. All the owner's choices are preferences on the server (hooks/prefs.ts).
import { PageHeader } from "@/components/page-header";
import { Highlight, HighlightItem } from "@animate-ui/react/primitives/effects/highlight";
import { Link, useSearch } from "@tanstack/react-router";
import { ArrowDownUp, Bell, Bot, ChevronLeft, ChevronRight, LayoutGrid, Mic, NotebookPen, Palette, Settings, Tag as TagIcon, Wrench, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useNarrow } from "@/hooks/media";
import type { SettingsSection } from "@/lib/route-search";
import { settingsScroll } from "@/lib/scroll";
import { cn } from "@/lib/utils";
import { Agent } from "@/components/settings/agent";
import { IconTile } from "@/components/settings/kit";
import { Appearance } from "@/components/settings/appearance";
import { ImportExport } from "@/components/settings/import-export";
import { Layouts } from "@/components/settings/layout";
import { Maintenance } from "@/components/settings/maintenance";
import { NotesSettings } from "@/components/settings/notes";
import { Reminders } from "@/components/settings/reminders";
import { Tags } from "@/components/settings/tags";
import { Voice } from "@/components/settings/voice";

/** The sections, each its own page picked from the settings sidebar (or the list, below `md`). */
const SECTIONS = [
  { id: "appearance", label: "Appearance", about: "Theme, colour", icon: Palette, body: Appearance },
  { id: "layout", label: "Layout", about: "Start screen, tabs, sidebar", icon: LayoutGrid, body: Layouts },
  { id: "notes", label: "Notes", about: "Actions, format tools, header", icon: NotebookPen, body: NotesSettings },
  { id: "agent", label: "Agent", about: "Model, permissions, memory", icon: Bot, body: Agent },
  { id: "voice", label: "Voice", about: "Dictation, Talk's voice", icon: Mic, body: Voice },
  { id: "reminders", label: "Reminders", about: "Notifications on this device", icon: Bell, body: Reminders },
  { id: "tags", label: "Tags", about: "Colours, descriptions", icon: TagIcon, body: Tags },
  { id: "transfer", label: "Import & export", about: "Markdown in and out", icon: ArrowDownUp, body: ImportExport },
  { id: "maintenance", label: "Maintenance", about: "Sync, offline copy, version", icon: Wrench, body: Maintenance },
] as const satisfies readonly { id: SettingsSection; label: string; about: string; icon: LucideIcon; body: () => ReactNode }[];

export function SettingsPane() {
  const narrow = useNarrow(), { section } = useSearch({ from: "/_app/settings" });
  const asked = SECTIONS.find((s) => s.id === section);
  const at = asked ?? (narrow ? undefined : SECTIONS[0]);

  if (narrow) {
    return (
      <main className="flex h-full min-w-0 flex-1 flex-col">
        {at ? (
          <PageHeader title={at.label} className="pl-1" icon={
            <Link to="/settings" search={{}} aria-label="Back to Settings" className="grid size-9 shrink-0 place-items-center rounded-lg text-dim hover:bg-muted"><ChevronLeft className="size-[22px]" /></Link>} />
        ) : <PageHeader title="Settings" />}
        <div data-scroll-restoration-id={settingsScroll(at?.id ?? "")} className="min-h-0 flex-1 overflow-y-auto">
          <div className="px-4 pt-1 pb-28 max-md:pb-[calc(var(--under-tabs)+1.5rem)]">
            {at ? <at.body /> : (
              <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
                {SECTIONS.map(({ id, label, about, icon }) => (
                  <li key={id}>
                    <Link to="/settings" search={{ section: id }} className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left outline-none hover:bg-muted focus-visible:bg-muted">
                      <IconTile icon={icon} tone="brand" />
                      <span className="min-w-0 flex-1"><span className="block text-[15px] font-medium">{label}</span><span className="block text-xs text-dim">{about}</span></span>
                      <ChevronRight className="size-4 shrink-0 text-faint" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </main>
    );
  }
  const shown = at ?? SECTIONS[0], Body = shown.body;
  return (
    <main className="flex h-full min-h-0 min-w-0 flex-1">
      <nav aria-label="Settings sections" className="w-52 shrink-0 border-r border-line px-3 pt-8">
        <div className="mb-3 flex items-center gap-2 px-2 text-brand"><Settings className="size-5" /><span className="text-xs font-semibold uppercase tracking-wider">Settings</span></div>
        <Highlight controlledItems value={shown.id} className="inset-0 rounded-lg bg-muted">
          <div className="space-y-1">
            {SECTIONS.map(({ id, label, icon: Icon }) => (
              <HighlightItem key={id} value={id}>
                <Link to="/settings" search={{ section: id }} aria-current={id === shown.id ? "page" : undefined}
                  className={cn("flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
                    id === shown.id ? "font-semibold text-fg" : "text-dim")}>
                  <Icon className="size-4" />{label}
                </Link>
              </HighlightItem>
            ))}
          </div>
        </Highlight>
      </nav>
      <article data-scroll-restoration-id={settingsScroll(shown.id)} className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 pt-8 pb-24 md:px-10"><Body /></div>
      </article>
    </main>
  );
}
