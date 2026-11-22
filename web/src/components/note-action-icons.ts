// Each note action (core/note-actions.ts) and its icon: the note's header and menu (note-header.tsx) and Settings → Notes draw them.
import {
  Archive, BookOpen, Bookmark, Bot, Brain, Briefcase, CalendarPlus, ChartBar, CheckCheck, Clock, Code, Copy, Download, FileText, Flag, Globe,
  GraduationCap, Hash, Heart, Languages, Lightbulb, Link2, ListChecks, ListOrdered, Mail, MapPin, Megaphone, MessageSquare, Palette, Paperclip, PenLine,
  Pin, Quote, Rocket, Scissors, Search, Shield, ShoppingCart, Sparkles, Star, Table2, Tag, Target, TextQuote, Users, WandSparkles, Zap, type LucideIcon,
} from "lucide-react";
import type { ActionIcon, Builtin } from "@/core/note-actions";

export const BUILTIN_ICON: Record<Builtin, LucideIcon> = {
  attach: Paperclip, pin: Pin, ask: Sparkles, copyMarkdown: Copy, copyLink: Link2, download: Download, archive: Archive,
};

export const PROMPT_ICON: Record<ActionIcon, LucideIcon> = {
  wand: WandSparkles, tasks: ListChecks, summary: TextQuote, sparkles: Sparkles, pencil: PenLine, list: ListOrdered, check: CheckCheck,
  languages: Languages, scissors: Scissors, lightbulb: Lightbulb, calendar: CalendarPlus, book: BookOpen, mail: Mail, hash: Hash,
  bot: Bot, brain: Brain, message: MessageSquare, quote: Quote, search: Search, tag: Tag, clock: Clock, star: Star, heart: Heart, flag: Flag,
  target: Target, zap: Zap, globe: Globe, code: Code, table: Table2, chart: ChartBar, file: FileText, bookmark: Bookmark, megaphone: Megaphone,
  palette: Palette, graduation: GraduationCap, cart: ShoppingCart, briefcase: Briefcase, pin: MapPin, users: Users, shield: Shield, rocket: Rocket,
};
