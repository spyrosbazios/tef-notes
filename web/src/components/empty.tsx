// An empty list's say (Animate UI's list entrance, calmer): the icon and its line fade in and rise a few pixels, once, on a critically
// damped spring (`spring.slide`, no overshoot) with the fade on `transition.reveal`. No loop. Under reduced motion it only fades.
// Inside an `AnimatePresence` it fades out when rows come (task-list.tsx).
import { spring, transition, useTempoTransition } from "@animate-ui/react/utils/motion";
import type { LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Empty({ icon: Icon, className, children }: { icon?: LucideIcon; className?: string; children: ReactNode }) {
  const glide = useTempoTransition(spring.slide), reveal = useTempoTransition(transition.reveal), fade = useTempoTransition(transition.fade);
  return (
    <motion.div className={cn("grid place-items-center gap-3 text-center", className)} initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0, transition: { ...glide, opacity: reveal } }} exit={{ opacity: 0, transition: fade }}>
      {Icon ? <Icon className="size-8 text-line" /> : null}
      {children}
    </motion.div>
  );
}
