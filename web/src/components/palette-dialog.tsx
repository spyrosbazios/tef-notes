// The ⌘K palette's frame: a modal like ui/dialog's, but moved the way a palette moves (Animate UI's recipes/palette.md): it is
// opened all day from the keyboard, so it fades and grows a little from the centre on the menu token and leaves the same way,
// where ui/dialog's tilt takes ~450 ms. Plain Radix Dialog parts (focus trap, Escape, outside click) with Motion on top, not the
// animated primitive, whose content shape can't be changed from outside. The backdrop is the theme's scrim (index.css).
import { ReducedMotionConfig, scale, transition as motionTransition, useTempoTransition } from "@animate-ui/react/utils/motion";
import { AnimatePresence, motion } from "motion/react";
import { Dialog as DialogPrimitive } from "radix-ui";
import type { ReactNode } from "react";

export function PaletteDialog({ open, onOpenChange, title, description, children }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description: string; children: ReactNode;
}) {
  const enter = useTempoTransition(motionTransition.menu);
  const hidden = { opacity: 0, scale: scale.menu };
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <ReducedMotionConfig>
        <AnimatePresence>
          {open ? (
            <DialogPrimitive.Portal forceMount>
              <DialogPrimitive.Overlay asChild forceMount>
                <motion.div data-slot="palette-overlay" className="fixed inset-0 isolate z-50"
                  initial={{ opacity: 0 }} animate={{ opacity: 1, transition: enter }} exit={{ opacity: 0, transition: enter }} />
              </DialogPrimitive.Overlay>
              <DialogPrimitive.Content asChild forceMount>
                <motion.div data-slot="palette-content"
                  className="fixed top-1/3 left-1/2 z-50 grid w-full max-w-[calc(100%-1rem)] -translate-x-1/2 overflow-hidden rounded-xl bg-popover p-0 text-sm text-popover-foreground ring-1 ring-foreground/10 outline-none max-sm:top-[max(0.5rem,env(safe-area-inset-top))] sm:max-w-2xl md:max-w-4xl"
                  initial={hidden} animate={{ opacity: 1, scale: 1, transition: enter }} exit={{ ...hidden, transition: enter }}>
                  <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
                  <DialogPrimitive.Description className="sr-only">{description}</DialogPrimitive.Description>
                  {children}
                </motion.div>
              </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
          ) : null}
        </AnimatePresence>
      </ReducedMotionConfig>
    </DialogPrimitive.Root>
  );
}
