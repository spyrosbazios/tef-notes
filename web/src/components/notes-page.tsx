// Notes as a page of its own (`/notes`): the notes Home lists under its tasks, alone, for an owner who keeps the two apart. Its tab
// is off until turned on in Settings → Layout (core/prefs.ts); the route works either way. The phone's header is Home's (the
// lens as the mark, Search in the corner) and stays put: only the notes under it scroll.
import { Search, X } from "lucide-react";
import { useCallback, useState } from "react";
import { LensSwitcher } from "@/components/lens-switcher";
import { NoteList } from "@/components/note-list";
import { HEADER_ICON, PageHeader } from "@/components/page-header";
import { SearchDrawer } from "@/components/search-drawer";
import { Button } from "@/components/ui/button";
import { useActiveLens } from "@/hooks/lens";
import { useNarrow } from "@/hooks/media";
import { useScrollMemory } from "@/hooks/scroll-memory";
import { hrefOf } from "@/lib/nav";
import { scrollKey } from "@/lib/scroll-memory";
import { cn } from "@/lib/utils";

export function NotesPage({ onNew }: { onNew: () => void }) {
  const phone = useNarrow(), lens = useActiveLens();
  const [searching, setSearching] = useState(false);
  const close = useCallback(() => setSearching(false), []);
  const page = useScrollMemory<HTMLDivElement>(scrollKey(hrefOf({ kind: "notes" }), lens?.rec), !(phone && searching));
  const top = (
    <PageHeader title={<LensSwitcher header />} actions={
      <Button variant="ghost" size="icon" aria-label={searching ? "Close search" : "Search"} onClick={() => setSearching((o) => !o)} className={cn(HEADER_ICON, searching && "text-brand hover:text-brand")}>
        {searching ? <X /> : <Search />}
      </Button>} />
  );
  if (phone && searching) return <SearchDrawer header={top} onClose={close} />;
  return (
    <div className="flex h-full flex-col">
      {phone ? top : null}
      <div ref={page} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-4 pt-8 pb-28 max-md:px-0 max-md:pt-2 max-md:pb-6 md:px-8">
          {phone ? null : <h1 className="mb-8 text-3xl font-bold tracking-tight">Notes</h1>}
          <NoteList onNew={onNew} />
        </div>
      </div>
    </div>
  );
}
