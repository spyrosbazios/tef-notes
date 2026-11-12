// The laptop's layout: rail | page | assistant, all in view from a wide window, where the phone shows one screen at a time. The page
// is the router's (`Outlet`: routes/_app/, Home, the task lists, Notes, Settings); a note is laid over it (`?note=<id>`, note-page.tsx) with
// no rail, and the screen it was opened from stays matched and mounted underneath, hidden and inert, so closing the note finds it
// exactly as it was: no reload of the tiles, no scroll to restore. A task opens beside its list (task-screen.tsx). The assistant is a
// dock on the right (components/assistant/dock.tsx), mounted here once so it outlives every screen. Narrower windows fold the rail
// into a sheet and lay the dock over the page, and on a phone-width one the list and the task take turns. An open task brings its
// own bar, so the narrow app bar steps aside and its back and menu buttons sit in that bar. Installed on a phone it is the whole
// screen (`h-dvh`, which follows the keyboard: index.html's `interactive-widget`), padded by the safe-area insets.
// Below `md` it is the phone's: the bottom tabs (tab-bar.tsx: Home, Tasks, Notes, Ask, Settings, as the owner set them) instead of the rail and the app bar, Home
// drawing its own header (lens, search), the Tasks tab the list with its own switcher (task-list.tsx), Ask the dock opened whole. From `md` to
// `lg` the app bar's buttons are the touch way to everything the keys do: Views, Assistant (a), Search (/ and ⌘K), New note or task (n, q).
import { Command as CommandIcon, Menu, Plus, Sparkles } from "lucide-react";
import { Outlet } from "@tanstack/react-router";
import { spring, useShouldReduceMotion, useTempoTransition } from "@animate-ui/react/utils/motion";
import { motion } from "motion/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AssistantFab } from "@/components/assistant/fab";
import { Dock } from "@/components/assistant/dock";
import { LensChip } from "@/components/lens-switcher";
import { NotePage } from "@/components/note-page";
import { OfflineBar } from "@/components/offline-bar";
import { Palette } from "@/components/palette";
import { QuickAdd, type Start } from "@/components/quick-add";
import { Rail } from "@/components/rail";
import { TabBar } from "@/components/tab-bar";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { dockNow, setDock, useDock } from "@/hooks/dock";
import { closeDrawing, openedNow } from "@/hooks/drawing";
import { useKeyboard } from "@/hooks/keyboard";
import { useRail, toggleRail } from "@/hooks/rail";
import { useLive } from "@/hooks/notes";
import { useNewNote } from "@/hooks/new-note";
import { INSETS, ShellContext, startOf, type ShellActions } from "@/hooks/shell";
import { typing } from "@/lib/keys";
import { TAB_BAR } from "@/lib/tabs";
import { landed, leaving } from "@/lib/morph";
import { isTaskView, titleOf, usePlace } from "@/lib/nav";
import { cn } from "@/lib/utils";

/** A note's page laid over the screen it was opened from. On a phone it covers the tab bar (kept, hidden, under it) and keeps clear of
 *  the bottom inset the shell leaves to the bar (`reach`);
 *  from `md` it covers the rail and the page and leaves the assistant's dock beside it. The focus moves in on opening and goes back to
 *  what had it (the tile) on closing. Its coming and going is the route's view transition (`data-vt="note"`, router.ts, index.css),
 *  grown out of and shrunk back into the tile it was opened from (lib/morph.ts). */
function NoteLayer({ id, reach }: { id: string; reach: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const [from] = useState(() => document.activeElement);   // read before the effect moves the focus: Strict Mode runs the effect twice
  useLayoutEffect(() => {
    ref.current?.focus({ preventScroll: true });
    return () => {
      // After the screen underneath is live again: an element that is hidden or inert can't take the focus
      requestAnimationFrame(() => {
        if (from instanceof HTMLElement && from.isConnected && document.activeElement === document.body) from.focus({ preventScroll: true });
      });
    };
  }, [from]);
  // Laid out before the new page is captured: the tile hands the card's name to this layer, and takes it back on the way out
  useLayoutEffect(() => { landed(); return () => leaving(id); }, [id]);
  return (
    <div data-vt="note" className={cn("absolute inset-0 z-20 flex flex-col bg-bg", reach && "max-md:pb-[env(safe-area-inset-bottom)]")}>
      <OfflineBar />
      <div className="flex min-h-0 flex-1">
        <main ref={ref} tabIndex={-1} className="min-w-0 flex-1 outline-none"><NotePage id={id} /></main>
      </div>
    </div>
  );
}

/** The layout route's component (routes/_app.tsx). */
export function Shell() {
  useLive();
  // The screen the router is on, and the note over it: the screen keeps its place, the note is only laid over it
  const { view, task, note } = usePlace();
  const onNote = !!note;
  const newNote = useNewNote();
  const [dock] = useDock();
  const [rail] = useRail(), reduce = useShouldReduceMotion(), railMove = useTempoTransition(spring.reflow);
  const keyboard = useKeyboard();
  const [palette, setPalette] = useState(false), [menu, setMenu] = useState(false), [adding, setAdding] = useState<Start | null>(null);

  // A drawing is open over its note's page: the note left (closed, another opened), the drawing goes too
  useEffect(() => { if (openedNow() && openedNow()?.noteId !== note) closeDrawing(); }, [note]);

  const kind = view.kind;
  // The `q` key on a note's page adds a task as Home's would, not as the list behind the note does
  const startKind = onNote ? "home" : kind;

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setPalette((p) => !p); }
      else if ((e.metaKey || e.ctrlKey) && e.key === "/") { e.preventDefault(); setDock({ open: !dockNow().open }); }
      else if (!typing(e) && !e.metaKey && !e.ctrlKey && !e.altKey && e.key === "a" && !document.querySelector("[role=dialog],[role=alertdialog]")) { e.preventDefault(); setDock({ open: !dockNow().open }); }
      else if (!typing(e) && !e.metaKey && !e.ctrlKey && !e.altKey && e.key === "/" && !document.querySelector("[role=dialog],[role=alertdialog]")) { e.preventDefault(); setPalette(true); }
      else if (!typing(e) && !e.metaKey && !e.ctrlKey && !e.altKey && e.key === "[" && !document.querySelector("[role=dialog],[role=alertdialog]")) { e.preventDefault(); toggleRail(); }
      else if (!typing(e) && !e.metaKey && !e.ctrlKey && !e.altKey && e.key === "n") { e.preventDefault(); newNote(); }
      else if (!typing(e) && !e.metaKey && !e.ctrlKey && !e.altKey && e.key === "q" && !document.querySelector("[role=dialog],[role=alertdialog]")) { e.preventDefault(); setAdding(startOf(startKind)); }
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [startKind, newNote]);

  const actions = useMemo<ShellActions>(() => ({ newNote, add: setAdding, openMenu: () => setMenu(true) }), [newNote]);

  const search = () => { setMenu(false); setPalette(true); };
  const tasks = isTaskView(view), focus = tasks && !!task;
  // The phone's bottom tabs: on every screen but an open task (a screen of its own, with a Back), and under the keyboard. A note's page
  // is another: its layer covers the tabs, which stay mounted (hidden) under it. The bar floats over the page, which runs on under it
  // and the bottom inset (the bar takes the inset as its own padding); every phone page's scroller ends `--under-tabs` lower, so its
  // last row can scroll up clear of the pill
  const bar = !focus && (onNote || !keyboard);

  return (
    <ShellContext.Provider value={actions}>
      <div className={cn("relative flex h-dvh flex-col overflow-hidden", INSETS, bar && "max-md:pb-0")}
        // What the assistant's dock leaves free under it below `md`: the bar and the inset it sits above
        style={{ "--dock-bottom": bar && !onNote ? `calc(${TAB_BAR} + env(safe-area-inset-bottom))` : "0px", "--tab-bar": TAB_BAR,
          "--under-tabs": bar ? `calc(${TAB_BAR} + env(safe-area-inset-bottom))` : "0px" } as CSSProperties}>
        <div className="flex min-h-0 flex-1">
          <div className="relative flex min-w-0 flex-1">
            {/* The screen behind a note's page: hidden and inert, but laid out and mounted, so it keeps its scroll and its pictures */}
            <div className={cn("flex min-w-0 flex-1", onNote && "invisible")} inert={onNote} data-under-note={onNote || undefined}>
              {/* Its width is the one thing that moves when it folds (rail.tsx): the page beside it reflows on the same spring */}
              <motion.aside initial={false} animate={{ width: rail.folded ? 60 : 240 }} transition={reduce ? { duration: 0 } : railMove}
                className="hidden shrink-0 overflow-hidden border-r border-line bg-bg lg:block"><Rail onSearch={search} fold={rail.folded} /></motion.aside>
              <Sheet open={menu} onOpenChange={setMenu}>
                <SheetContent side="left" className="w-64 p-0"><SheetTitle className="sr-only">Views</SheetTitle><Rail onSearch={search} onPick={() => setMenu(false)} /></SheetContent>
              </Sheet>

              <div className="flex min-w-0 flex-1 flex-col">
                <OfflineBar />
                <div className={cn("flex h-12 shrink-0 items-center gap-1 border-b border-line px-2 max-md:hidden lg:hidden", focus && "hidden")}>
                  <Button variant="ghost" size="icon" aria-label="Views" onClick={() => setMenu(true)}><Menu /></Button>
                  <span className="flex-1 truncate font-semibold">{titleOf(view)}</span>
                  <LensChip />
                  <Button variant={dock.open ? "secondary" : "ghost"} size="icon" aria-label="Assistant" aria-pressed={dock.open} onClick={() => setDock({ open: !dock.open })}><Sparkles /></Button>
                  <Button variant="ghost" size="icon" aria-label="Search" onClick={() => setPalette(true)}><CommandIcon /></Button>
                  <Button variant="ghost" size="icon" aria-label={tasks ? "New task" : "New note"} onClick={() => (tasks ? setAdding(startOf(kind)) : newNote())}><Plus /></Button>
                </div>

                {/* What a route change crossfades (`data-vt="page"`, index.css): the rail, the app bar, the tabs and the dock stay put */}
                <div data-vt="page" className="flex min-h-0 flex-1"><Outlet /></div>
              </div>
            </div>
            {note ? <NoteLayer id={note} reach={bar} /> : null}
          </div>

          <Dock />
          {!dock.open && <AssistantFab />}

          <Palette open={palette} onOpenChange={setPalette} onNew={newNote} />
          <QuickAdd initial={adding} onClose={() => setAdding(null)} />
        </div>
        {/* The pill inside is what a route change names (`data-vt="tabs"`, tab-bar.tsx), not this strip */}
        {bar ? <div className={cn("pointer-events-none absolute inset-x-0 bottom-0 z-50 pb-[env(safe-area-inset-bottom)] md:hidden", onNote && "invisible")} inert={onNote}><TabBar /></div> : null}
      </div>
    </ShellContext.Provider>
  );
}
