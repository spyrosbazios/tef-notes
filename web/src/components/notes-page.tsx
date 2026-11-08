// Notes as a page of its own (`/notes`, routes/_app/notes.tsx): the notes Home lists under its tasks, alone, for an owner who keeps
// the two apart. Its tab is off until turned on in Settings → Layout (core/prefs.ts); the route works either way. Its tag filter is
// `?tags=` like Home's, and its scroll the router's under an id of its own (lib/scroll.ts `notesScroll`). The phone's header is
// Home's: the lens as the mark, Search in the corner, whose drawer lies over the page; the header stays put, only the notes under it scroll.
import { Search, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useRef, useState } from "react";
import { LensSwitcher } from "@/components/lens-switcher";
import { NoteList } from "@/components/note-list";
import { HEADER_ICON, PageHeader } from "@/components/page-header";
import { SearchDrawer } from "@/components/search-drawer";
import { Button } from "@/components/ui/button";
import { useActiveLens } from "@/hooks/lens";
import { useNarrow } from "@/hooks/media";
import { useScrollSwitch } from "@/hooks/scroll";
import { useShell } from "@/hooks/shell";
import { isNotesView, usePlace } from "@/lib/nav";
import { notesScroll } from "@/lib/scroll";
import { cn } from "@/lib/utils";

const NO_TAGS: string[] = [];

export function NotesPage() {
  const { newNote } = useShell();
  const phone = useNarrow(), lens = useActiveLens();
  const [searching, setSearching] = useState(false);
  const close = useCallback(() => setSearching(false), []);
  const { view } = usePlace();
  const scrollId = notesScroll(isNotesView(view) ? view.tags ?? NO_TAGS : NO_TAGS, lens?.rec);
  // A lens is switched on the page, not navigated to: the scroller puts its place back (hooks/scroll.ts)
  const page = useRef<HTMLDivElement>(null);
  useScrollSwitch(page, scrollId);
  const top = (
    <PageHeader title={<LensSwitcher header />} actions={
      <Button variant="ghost" size="icon" aria-label={searching ? "Close search" : "Search"} onClick={() => setSearching((o) => !o)} className={cn(HEADER_ICON, searching && "text-brand hover:text-brand")}>
        {searching ? <X /> : <Search />}
      </Button>} />
  );
  return (
    <main className="relative flex h-full min-w-0 flex-1 flex-col">
      <AnimatePresence>{phone && searching ? <motion.div key="search" className="absolute inset-0 z-10"><SearchDrawer header={top} onClose={close} /></motion.div> : null}</AnimatePresence>
      {phone ? top : null}
      {/* No scroll anchoring, as Home's: the router's restore lands before the masonry settles */}
      <div ref={page} data-scroll-restoration-id={scrollId} className="min-h-0 flex-1 overflow-y-auto [overflow-anchor:none]" inert={phone && searching}>
        <div className="mx-auto max-w-6xl px-4 pt-8 pb-28 max-md:px-0 max-md:pt-2 max-md:pb-6 md:px-8">
          {phone ? null : <h1 className="mb-8 text-3xl font-bold tracking-tight">Notes</h1>}
          <NoteList onNew={newNote} scrollId={scrollId} />
        </div>
      </div>
    </main>
  );
}
