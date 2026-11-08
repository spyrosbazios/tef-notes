// A form that saves: a dialog in a window, a bottom sheet below `md`. In the sheet the title stays at the top and the buttons at the
// bottom, above the keyboard, while only the fields between them scroll, so Save is always in reach. The lens form and New task use it.
import { createContext, useContext, type ReactNode } from "react";
import { InSheet } from "@/components/pick";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { useNarrow } from "@/hooks/media";
import { cn } from "@/lib/utils";

const InDrawer = createContext(false);

/** The frame: `open` shows it, closing it any way calls `onClose`. `width` is the dialog's. Its child is mounted per opening and
 *  draws a `SheetForm`. */
export function FormSheet({ open, onClose, width = "sm:max-w-md", children }: { open: boolean; onClose: () => void; width?: string; children: ReactNode }) {
  const narrow = useNarrow();
  const change = (o: boolean) => { if (!o) onClose(); };
  if (narrow) {
    return (
      <Drawer open={open} onOpenChange={change}>
        <DrawerContent className="data-[vaul-drawer-direction=bottom]:max-h-[92dvh]">
          <InDrawer.Provider value><InSheet value>{children}</InSheet></InDrawer.Provider>
        </DrawerContent>
      </Drawer>
    );
  }
  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent className={width}>{children}</DialogContent>
    </Dialog>
  );
}

/** The form inside a `FormSheet`: a title (and a line under it), the fields, and `actions` (Cancel and the submit button), which in a
 *  sheet sit side by side in a bar pinned to its foot. `sheet` tells the fields whether they are in the sheet (to hold back the
 *  keyboard, say). */
export function SheetForm({ title, description, onSubmit, actions, className, children }: {
  title: string; description?: string; onSubmit: (e: React.FormEvent) => void; actions: ReactNode; className?: string; children: ReactNode;
}) {
  const sheet = useInDrawer();
  if (!sheet) {
    return (
      <form onSubmit={onSubmit} className="flex flex-col gap-5">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div className={className}>{children}</div>
        <div className="flex justify-end gap-2">{actions}</div>
      </form>
    );
  }
  return (
    <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
      <div className="px-4 pt-1 pb-2 text-center">
        <DrawerTitle className="text-[15px] font-semibold">{title}</DrawerTitle>
        {description ? <DrawerDescription className="mt-0.5 text-xs">{description}</DrawerDescription> : null}
      </div>
      <div className={cn("min-h-0 flex-1 overflow-y-auto px-4 py-3", className)}>{children}</div>
      <div className="grid shrink-0 auto-cols-fr grid-flow-col gap-2 border-t border-line px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{actions}</div>
    </form>
  );
}

/** Drawn inside a `FormSheet`'s bottom sheet. */
export const useInDrawer = () => useContext(InDrawer);
