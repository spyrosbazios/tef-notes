// A part of the screen that failed to draw says so in its own place, with a way to try again, instead of one render throw taking
// the whole shell down. Around the note's page, the dock, Reader, the PDF viewer and the drawing editor (`Boundary`); the app's
// route has the full-screen one (`AppFailed`, routes/_app.tsx `errorComponent`). The router's own CatchBoundary does the catching.
import { CatchBoundary, type ErrorComponentProps } from "@tanstack/react-router";
import { RotateCw, TriangleAlert } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { INSETS } from "@/hooks/shell";
import { cn } from "@/lib/utils";
import { message } from "@/services/api";

/** What failed (`what`: "The note", "The assistant"…), why, and Try again: it draws the part afresh. */
export function Failed({ error, reset, what, className }: ErrorComponentProps & { what: string; className?: string }) {
  return (
    <div role="alert" className={cn("grid size-full min-h-32 place-items-center p-6 text-center", className)}>
      <div className="flex max-w-sm flex-col items-center gap-3">
        <TriangleAlert className="size-8 text-down" />
        <p className="text-sm text-fg">{what} couldn’t be shown.</p>
        <p className="break-words text-xs text-faint">{message(error)}</p>
        <Button variant="outline" size="sm" onClick={reset}><RotateCw /> Try again</Button>
      </div>
    </div>
  );
}

/** Catches a throw in `children`; a new `resetKey` (another note, another URL) draws them afresh by itself. */
export function Boundary({ what, resetKey = 0, children }: { what: string; resetKey?: unknown; children: ReactNode }) {
  const view = useMemo(() => function Failure(p: ErrorComponentProps) { return <Failed {...p} what={what} />; }, [what]);
  return <CatchBoundary getResetKey={() => resetKey} errorComponent={view}>{children}</CatchBoundary>;
}

/** The app's screens failed as a whole (the `_app` route's `errorComponent`): Try again, or reload the page. */
export function AppFailed(p: ErrorComponentProps) {
  return (
    <div className={cn("flex h-dvh flex-col items-center justify-center gap-2", INSETS)}>
      <Failed {...p} what="This screen" className="size-auto min-h-0" />
      <Button variant="ghost" size="sm" onClick={() => location.reload()}>Reload the app</Button>
    </div>
  );
}
