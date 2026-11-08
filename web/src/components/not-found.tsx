// An address the app has no screen for (the root route's `notFoundComponent`).
import { Link } from "@tanstack/react-router";
import { FileQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { INSETS } from "@/hooks/shell";
import { cn } from "@/lib/utils";

export function NotFound() {
  return (
    <div className={cn("grid h-dvh place-items-center px-6 text-center", INSETS)}>
      <div className="space-y-4">
        <FileQuestion className="mx-auto size-10 text-line" />
        <p className="text-sm text-dim">Nothing lives at this address.</p>
        <Button asChild variant="outline" size="sm"><Link to="/">Go Home</Link></Button>
      </div>
    </div>
  );
}
