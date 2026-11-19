// Each note action (core/note-actions.ts) and its icon: the note's header and menu (note-header.tsx) and Settings → Notes draw them.
import {
  Archive, BookOpen, CalendarPlus, CheckCheck, Download, FileCode, Hash, Languages, Lightbulb, Link2, ListChecks, ListOrdered, Mail, Paperclip, PenLine, Pin,
  Scissors, Sparkles, TextQuote, WandSparkles, type LucideIcon,
} from "lucide-react";
import type { ActionIcon, Builtin } from "@/core/note-actions";

export const BUILTIN_ICON: Record<Builtin, LucideIcon> = {
  attach: Paperclip, pin: Pin, ask: Sparkles, source: FileCode, copyLink: Link2, download: Download, archive: Archive,
};

export const PROMPT_ICON: Record<ActionIcon, LucideIcon> = {
  wand: WandSparkles, tasks: ListChecks, summary: TextQuote, sparkles: Sparkles, pencil: PenLine, list: ListOrdered, check: CheckCheck,
  languages: Languages, scissors: Scissors, lightbulb: Lightbulb, calendar: CalendarPlus, book: BookOpen, mail: Mail, hash: Hash,
};
