// The headings every Settings page shares (settings-pane.tsx and the pages kept in files of their own).
import { cn } from "@/lib/utils";

/** A section's title stays at the top of the scrolling page. */
export const HEAD = "sticky top-0 z-10 -mx-1 bg-bg/95 px-1 py-2 font-bold text-lg tracking-tight backdrop-blur";
/** A section page's own title. On the phone the page header already names the section, so it is only read out there. */
export const TITLE = cn(HEAD, "max-md:sr-only");
/** A group inside a section page: one step below the page title, scrolls with the page. */
export const SUB = "text-base font-bold tracking-tight";
