// The laptop's layout: rail | page | assistant, all in view from a wide window, where the phone shows one screen at a time. Home is where
// the notes are; a note is a page of its own (`/note/<id>`, note-page.tsx) with no rail, laid over the screen it was opened from
// (which stays mounted underneath, hidden and inert, so closing the note finds it exactly as it was: no reload of the tiles, no
// scroll to restore), and a task opens beside its list. The
// assistant is a dock on the right (components/assistant/dock.tsx), mounted here once so it outlives every route. Narrower windows
// fold the rail into a sheet and lay the dock over the page, and on a phone-width one the list and the task take turns. An open
// task brings its own bar, so the narrow app bar steps aside and its back and menu buttons sit in that bar. Installed on a phone it
// is the whole screen (`h-dvh`, which follows the keyboard: index.html's `interactive-widget`), padded by the safe-area insets.
// Below `md` it is the phone's: the bottom tabs (tab-bar.tsx: Home, Tasks, Notes, Ask, Settings, as the owner set them) instead of the rail and the app bar, Home
// drawing its own header (lens, search), the Tasks tab the list with its own switcher (task-list.tsx), Ask the dock opened whole. From `md` to
// `lg` the app bar's buttons are the touch way to everything the keys do: Views, Assistant (a), Search (/ and ⌘K), New note or task (n, q).
import { Command as CommandIcon, ListTodo, Menu, Plus, Sparkles } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useRoute } from "wouter";
import { AssistantFab } from "@/components/assistant/fab";
import { Dock } from "@/components/assistant/dock";
import { Home } from "@/components/home";
import { LensChip } from "@/components/lens-switcher";
import { NotePage } from "@/components/note-page";
import { NotesPage } from "@/components/notes-page";
import { OfflineBar } from "@/components/offline-bar";
import { Palette } from "@/components/palette";
import { QuickAdd, type Start } from "@/components/quick-add";
import { Rail } from "@/components/rail";
import { SettingsPane } from "@/components/settings-pane";
import { SharePage } from "@/components/share-page";
import { TabBar } from "@/components/tab-bar";
import { DetailLeading, TaskDetail } from "@/components/task-detail";
import { TaskList } from "@/components/task-list";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { dockNow, setDock, useDock } from "@/hooks/dock";
import { useKeyboard } from "@/hooks/keyboard";
import { useLive } from "@/hooks/notes";
import { useNewNote } from "@/hooks/new-note";
import { useStartScreen } from "@/hooks/start";
import { useTasks } from "@/hooks/todo";
import { typing } from "@/lib/keys";
import { TAB_BAR } from "@/lib/tabs";
import { localDay } from "@/core/time";
import { Behind, hrefOf, isTaskView, placeOf, titleOf, useBehind, useNav, type View } from "@/lib/nav";
import { cn } from "@/lib/utils";

function Nothing() {
  return (
    <div className="grid h-full place-items-center px-6 text-center">
      <div className="space-y-4">
        <ListTodo className="mx-auto size-10 text-line" />
        <p className="text-sm text-dim">Pick a task, or add one.</p>
        <div className="flex justify-center gap-4 text-xs text-faint any-pointer-coarse:hidden">
          <span className="inline-flex items-center gap-1.5"><Kbd>Q</Kbd> task</span>
          <span className="inline-flex items-center gap-1.5"><Kbd>N</Kbd> new note</span>
          <span className="inline-flex items-center gap-1.5"><Kbd>⌘K</Kbd> search</span>
        </div>
      </div>
    </div>
  );
}

function Pane({ onMenu }: { onMenu: () => void }) {
  const { task, openTask } = useNav();
  const tasks = useTasks();
  if (!task) return <Nothing />;
  const t = tasks.data?.find((x) => x.id === task);
  if (!t) return tasks.isPending ? null : <div className="grid h-full place-items-center text-sm text-faint">This task is gone: deleted on another device.</div>;
  return <TaskDetail key={t.id} task={t} leading={<DetailLeading onBack={() => openTask(null)} onMenu={onMenu} />} onGone={() => openTask(null)} />;
}

/** A task added from Today starts on Today. */
const startOf = (kind: View["kind"]): Start => ({ schedule: kind === "today" ? { when: localDay(), evening: false } : null });

/** The screen is the whole window (an installed app): clear of a notch, the gesture bar and rounded corners. */
const INSETS = "pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]";

/** A note's page laid over the screen it was opened from. On a phone it reaches down over the tab bar (`reach`: kept, hidden, under it);
 *  from `md` it covers the rail and the page and leaves the assistant's dock beside it. The focus moves in on opening and goes back to
 *  what had it (the tile) on closing. */
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
  return (
    <div className={cn("absolute inset-0 z-20 flex flex-col bg-bg", reach && "max-md:-bottom-(--tab-bar)")}>
      <OfflineBar />
      <div className="flex min-h-0 flex-1">
        <main ref={ref} tabIndex={-1} className="min-w-0 flex-1 outline-none"><NotePage id={id} /></main>
      </div>
    </div>
  );
}

function Shell() {
  useLive();
  useStartScreen();
  const { open } = useNav();
  const [onNote] = useRoute("/note/:id");
  // The screen the app is on, which a note's page covers without unmounting it: its place, not the note's
  const behind = useBehind();
  const { view, task } = placeOf(behind);
  const [onShare] = useRoute("/share");
  const newNote = useNewNote();
  const [dock] = useDock();
  const keyboard = useKeyboard();
  const [palette, setPalette] = useState(false), [menu, setMenu] = useState(false), [adding, setAdding] = useState<Start | null>(null);

  const kind = view.kind;
  // The `q` key on a note's page adds a task as Home's would, not as the list behind the note does
  const startKind = onNote ? "home" : kind;

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setPalette((p) => !p); }
      else if ((e.metaKey || e.ctrlKey) && e.key === "/") { e.preventDefault(); setDock({ open: !dockNow().open }); }
      else if (!typing(e) && !e.metaKey && !e.ctrlKey && !e.altKey && e.key === "a" && !document.querySelector("[role=dialog],[role=alertdialog]")) { e.preventDefault(); setDock({ open: !dockNow().open }); }
      else if (!typing(e) && !e.metaKey && !e.ctrlKey && !e.altKey && e.key === "/" && !document.querySelector("[role=dialog],[role=alertdialog]")) { e.preventDefault(); setPalette(true); }
      else if (!typing(e) && !e.metaKey && !e.ctrlKey && !e.altKey && e.key === "n") { e.preventDefault(); newNote(); }
      else if (!typing(e) && !e.metaKey && !e.ctrlKey && !e.altKey && e.key === "q" && !document.querySelector("[role=dialog],[role=alertdialog]")) { e.preventDefault(); setAdding(startOf(startKind)); }
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [startKind, newNote]);

  if (onShare) return <div className={cn("h-dvh", INSETS)}><SharePage /></div>;

  const rail = <Rail onSearch={() => { setMenu(false); setPalette(true); }} onPick={() => setMenu(false)} />;
  const tasks = isTaskView(view), focus = tasks && !!task;
  const home = view.kind === "home";
  // The phone's bottom tabs: on every screen but an open task (a screen of its own, with a Back), and under the keyboard. A note's page
  // is another: its layer reaches over the tabs, which stay mounted (hidden) under it so the screen behind keeps its size
  const bar = !focus && (onNote || !keyboard);

  return (
    <div className={cn("flex h-dvh flex-col overflow-hidden", INSETS)}
      // What the assistant's dock leaves free under it below `md`: the bar and the inset it sits above
      style={{ "--dock-bottom": bar && !onNote ? `calc(${TAB_BAR} + env(safe-area-inset-bottom))` : "0px", "--tab-bar": TAB_BAR } as CSSProperties}>
      <div className="flex min-h-0 flex-1">
        <div className="relative flex min-w-0 flex-1">
          {/* The screen behind a note's page: hidden and inert, but laid out and mounted, so it keeps its scroll and its pictures */}
          <Behind.Provider value={behind}>
            <div className={cn("flex min-w-0 flex-1", onNote && "invisible")} inert={onNote}>
              <aside className="hidden w-60 shrink-0 border-r border-line bg-bg lg:block">{rail}</aside>
              <Sheet open={menu} onOpenChange={setMenu}>
                <SheetContent side="left" className="w-64 p-0"><SheetTitle className="sr-only">Views</SheetTitle>{rail}</SheetContent>
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

                <div className="flex min-h-0 flex-1">
                  {home ? <main className="min-w-0 flex-1"><Home onNew={newNote} onAdd={setAdding} /></main> : kind === "notes" ? <main className="min-w-0 flex-1"><NotesPage onNew={newNote} /></main> : !isTaskView(view) ? <main className="min-w-0 flex-1"><SettingsPane /></main> : (
                    <>
                      <div className={cn("w-full shrink-0 border-r border-line md:w-[360px] xl:w-[420px]", focus && "max-md:hidden")}>
                        <TaskList key={hrefOf(view)} view={view} onAdd={() => setAdding(startOf(kind))} />
                      </div>
                      <main className={cn("min-w-0 flex-1", !focus && "max-md:hidden")}><Pane onMenu={() => setMenu(true)} /></main>
                    </>
                  )}
                </div>
              </div>
            </div>
          </Behind.Provider>
          {onNote && open ? <NoteLayer id={open} reach={bar} /> : null}
        </div>

        <Dock />
        {!dock.open && <AssistantFab />}

        <Palette open={palette} onOpenChange={setPalette} onNew={newNote} />
        <QuickAdd initial={adding} onClose={() => setAdding(null)} />
      </div>
      {bar ? (
        <Behind.Provider value={behind}>
          <div className={cn("shrink-0", onNote && "invisible")} inert={onNote}><TabBar /></div>
        </Behind.Provider>
      ) : null}
    </div>
  );
}

export default Shell;
