// A pointer that hovers (a mouse or a trackpad, not a finger): the gate for any hover-driven motion written by hand (a tooltip, a gliding
// highlight). Touch browsers fire `mouseenter` on a tap and never `mouseleave`, so a hover state would stick.
import { useMedia } from "@/hooks/media";

export const useHovers = () => useMedia("(hover: hover) and (pointer: fine)");
