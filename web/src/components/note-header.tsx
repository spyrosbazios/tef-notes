// The right of a note's header: its actions (core/note-actions.ts), each where this layout's preferences put it
// (`phone.noteHeader`, `desktop.noteHeader`): a button here, a row in the menu, or off. The app's own (attach, pin, ask,
// markdown source, copy link, download, archive) and the owner's assistant actions share the list; an assistant action is drawn
// in the brand colour and turns while it runs. The colour and Delete are the menu's, always. A menu row carries "Pin to
// header" while the header has room; the rest is set in Settings → Notes.
import { Link } from "@tanstack/react-router";
import { ArchiveRestore, ArrowUpToLine, EllipsisVertical, FileUp, Loader2, PenTool, SlidersHorizontal, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { Swatches } from "@/components/note-actions";
import { BUILTIN_ICON, PROMPT_ICON } from "@/components/note-action-icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { BUILTIN_LABEL, headerRoom, idsAt, isBuiltin, placedAt, type Builtin, type PromptAction } from "@/core/note-actions";
import type { Color } from "@/core/notes";
import { useModel } from "@/hooks/agent";
import { useLayout } from "@/hooks/media";
import { prefsNow, setPrefs, usePrefs } from "@/hooks/prefs";

/** The app's own actions that are one press each (attach opens a choice of two). */
type Own = Exclude<Builtin, "attach">;
const isOwn = (id: string): id is Own => isBuiltin(id) && id !== "attach";

type Props = {
  pinned: boolean; archived: boolean; color?: Color; raw: boolean;
  /** "Download" or "Share": what taking the note out is called on this device. */
  saveVerb: string;
  /** The action whose run is on its way, by id. */
  running: string | null;
  onFile: () => void; onDraw: () => void; onPin: () => void; onAsk: () => void; onRaw: (on: boolean) => void; onCopyLink: () => void;
  onSave: () => void; onArchive: () => void; onColor: (c: Color | null) => void; onDelete: () => void; onRun: (a: PromptAction) => void;
};

function IconButton({ label, children, ...p }: React.ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild><Button variant="ghost" size="icon" aria-label={label} {...p}>{children}</Button></TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** A menu row's "Pin to header": a press here moves the action up and leaves the menu open. */
function PinUp({ label, onPin }: { label: string; onPin: () => void }) {
  return (
    <button type="button" aria-label={`Pin ${label} to the header`} title="Pin to header"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onPin(); }} onPointerUp={(e) => e.stopPropagation()}
      className="-my-0.5 -mr-0.5 ml-auto grid size-6 shrink-0 place-items-center rounded-md text-faint opacity-0 outline-none hover:bg-line hover:text-fg focus-visible:opacity-100 group-hover/dropdown-menu-item:opacity-100 group-focus/dropdown-menu-item:opacity-100 any-pointer-coarse:opacity-100">
      <ArrowUpToLine className="size-3.5" />
    </button>
  );
}

export function NoteHeaderActions(p: Props) {
  const layout = useLayout(), prefs = usePrefs();
  const slots = prefs[layout].noteHeader, prompts = prefs.noteActions;
  const room = headerRoom(slots, layout), off = !useModel().model;       // no model key: the agent is off, and so are its buttons
  const pinUp = (id: string) => {
    const noteHeader = placedAt(prefsNow()[layout].noteHeader, layout, id, "header");
    setPrefs(layout === "phone" ? { phone: { noteHeader } } : { desktop: { noteHeader } });
  };

  // What each of the app's own shows and does (attach is two things, drawn by itself below)
  const own: Record<Own, { label: string; icon: ReactNode; act: () => void; pressed?: boolean }> = (() => {
    const { pin: Pin, ask: Ask, source: Source, copyLink: Copy, download: Save, archive: Archive } = BUILTIN_ICON;
    return {
      pin: { label: p.pinned ? "Unpin" : BUILTIN_LABEL.pin, icon: <Pin className={p.pinned ? "fill-fg text-fg" : "text-dim"} />, act: p.onPin, pressed: p.pinned },
      ask: { label: BUILTIN_LABEL.ask, icon: <Ask className="text-dim" />, act: p.onAsk },
      source: { label: BUILTIN_LABEL.source, icon: <Source className={p.raw ? "text-fg" : "text-dim"} />, act: () => p.onRaw(!p.raw), pressed: p.raw },
      copyLink: { label: BUILTIN_LABEL.copyLink, icon: <Copy className="text-dim" />, act: p.onCopyLink },
      download: { label: `${p.saveVerb} .md`, icon: <Save className="text-dim" />, act: p.onSave },
      archive: { label: p.archived ? "Unarchive" : BUILTIN_LABEL.archive, icon: p.archived ? <ArchiveRestore className="text-dim" /> : <Archive className="text-dim" />, act: p.onArchive },
    };
  })();
  const Attach = BUILTIN_ICON.attach;

  const button = (id: string) => {
    if (id === "attach") return (
      <DropdownMenu key={id}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={BUILTIN_LABEL.attach}><Attach className="text-dim" /></Button></DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{BUILTIN_LABEL.attach}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onSelect={p.onFile}><FileUp /> Photo or PDF…</DropdownMenuItem>
          <DropdownMenuItem onSelect={p.onDraw}><PenTool /> New drawing</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
    if (isOwn(id)) {
      const b = own[id];
      return <IconButton key={id} label={b.label} aria-pressed={b.pressed} onClick={b.act}>{b.icon}</IconButton>;
    }
    const a = prompts.find((x) => x.id === id);
    if (!a) return null;
    const Icon = PROMPT_ICON[a.icon], busy = p.running === a.id;
    return (
      <IconButton key={id} label={a.label} aria-busy={busy} disabled={off || (!!p.running && !busy)} onClick={() => { if (!busy) p.onRun(a); }}>
        {busy ? <Loader2 className="animate-spin text-brand" /> : <Icon className="text-brand" />}
      </IconButton>
    );
  };

  const row = (id: string) => {
    const up = (label: string) => (room ? <PinUp label={label} onPin={() => pinUp(id)} /> : null);
    if (id === "attach") return [
      <DropdownMenuItem key="file" onSelect={p.onFile}><FileUp /> Photo or PDF…{up(BUILTIN_LABEL.attach)}</DropdownMenuItem>,
      <DropdownMenuItem key="draw" onSelect={p.onDraw}><PenTool /> New drawing</DropdownMenuItem>,
    ];
    if (isOwn(id)) {
      const b = own[id];
      return <DropdownMenuItem key={id} onSelect={b.act}>{b.icon} {b.label}{up(b.label)}</DropdownMenuItem>;
    }
    const a = prompts.find((x) => x.id === id);
    if (!a) return null;
    const Icon = PROMPT_ICON[a.icon];
    return (
      <DropdownMenuItem key={id} disabled={off || !!p.running} onSelect={() => p.onRun(a)}>
        <Icon className="text-brand" /> <span className="min-w-0 truncate">{a.label}</span>{up(a.label)}
      </DropdownMenuItem>
    );
  };

  // The menu: the assistant's rows first (the owner's actions and Ask), then the app's own, each group in the list's order
  const menu = idsAt(slots, "menu"), assistant = menu.filter((id) => id === "ask" || !isBuiltin(id)), rest = menu.filter((id) => !assistant.includes(id));

  return (
    <>
      {idsAt(slots, "header").map(button)}
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="More"><EllipsisVertical className="text-dim" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="text-faint text-xs">Colour</DropdownMenuLabel>
          <Swatches value={p.color} onPick={p.onColor} />
          <DropdownMenuSeparator />
          {assistant.length ? (
            <>
              <DropdownMenuLabel className="text-faint text-xs">Assistant</DropdownMenuLabel>
              {assistant.map(row)}
              <DropdownMenuSeparator />
            </>
          ) : null}
          {rest.map(row)}
          {rest.length ? <DropdownMenuSeparator /> : null}
          <DropdownMenuItem asChild>
            <Link to="/settings" search={{ section: "notes" }}><SlidersHorizontal /> Customise…</Link>
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={p.onDelete}><Trash2 /> Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
