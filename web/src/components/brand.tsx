// The brand mark: the launcher's notebook-and-tau (packages/core/src/brand.ts, the path the phone, the site and the
// extension draw too) in the brand colour, then the wordmark.
import { MARK_PATH, MARK_VIEWBOX } from "@/core/brand";

export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox={MARK_VIEWBOX} className={className} fill="currentColor" aria-hidden="true">
      <path d={MARK_PATH} fillRule="evenodd" />
    </svg>
  );
}

/** `folded`: the desktop rail is down to its icons; the mark stays and the wordmark fades under the clip. */
export function Brand({ folded = false }: { folded?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <Mark className="size-6 shrink-0 text-brand" />
      <span className={`whitespace-nowrap font-extrabold text-xl leading-none tracking-tight transition-opacity duration-200 ${folded ? "opacity-0" : ""}`}>TEF Notes</span>
    </div>
  );
}
