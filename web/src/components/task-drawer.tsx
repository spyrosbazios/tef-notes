// The open task as a drawer over the screen it was opened from (Home, the assistant, a note, a search), which stays as it is
// underneath: a bottom sheet below `md`, pulled down to close, a panel from the right in a wider window. A task list in a wide
// window shows it beside the list instead (task-screen.tsx; the rule is lib/nav.ts `taskInDrawer`). Which task is the URL's
// (`?t=<id>`), so the back gesture closes it; the card is task-detail.tsx's.
import { ChevronDown, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { InSheet } from "@/components/pick";
import { OpenTask } from "@/components/task-detail";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useNarrow } from "@/hooks/media";
import { useTasks } from "@/hooks/todo";
import { taskInDrawer, useNav, usePlace } from "@/lib/nav";

/** Mounted once by the shell: open while the place has a task that is not beside its list. */
export function TaskDrawer() {
  const narrow = useNarrow(), place = usePlace(), { closeTask } = useNav();
  const id = taskInDrawer(place, narrow) ? place.task : undefined;
  // The card stays the last task's while the drawer slides away
  const [shown, setShown] = useState(id);
  if (id && id !== shown) setShown(id);
  const title = useTasks().data?.find((t) => t.id === shown)?.title ?? "Task";
  // Closed once per opening: a step back takes a moment to land, and a second one would leave the screen under the drawer too
  const leaving = useRef(false);
  useEffect(() => { leaving.current = false; }, [id]);
  const close = () => {
    if (!id || leaving.current) return;
    leaving.current = true;
    closeTask();
  };
  const change = (o: boolean) => { if (!o) close(); };
  const card = shown ? (
    <OpenTask id={shown} onGone={close}
      leading={<Button variant="ghost" size="icon-sm" aria-label="Close" onClick={close}>{narrow ? <ChevronDown /> : <X />}</Button>} />
  ) : null;
  if (narrow) {
    return (
      <Drawer open={!!id} repositionInputs={false} onOpenChange={change}>
        <DrawerContent className="data-[vaul-drawer-direction=bottom]:h-[92dvh] data-[vaul-drawer-direction=bottom]:max-h-[92dvh]">
          <DrawerTitle className="sr-only">{title}</DrawerTitle>
          <InSheet value>{card}</InSheet>
        </DrawerContent>
      </Drawer>
    );
  }
  return (
    <Sheet open={!!id} onOpenChange={change}>
      <SheetContent side="right" showCloseButton={false} className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
        <SheetTitle className="sr-only">{title}</SheetTitle>
        {card}
      </SheetContent>
    </Sheet>
  );
}
