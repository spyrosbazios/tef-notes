// Reader view: a linked page as an article in a dialog, its menus, ads and comments gone (core/reader.ts; the server
// finds the article). Opened from a link card's "Reader view" button; the page itself is a click away.
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useNarrow } from "@/hooks/media";
import { Skeleton } from "@/components/ui/skeleton";
import { readingMinutes } from "@/core/reader";
import { message } from "@/services/api";
import * as reader from "@/services/reader";

const HOUR = 3_600_000;

/** `url`: the page; null is closed. `onNote`: a link to a note in the article (rare, but the same as a note's). */
export function Reader({ url, onClose, onNote }: { url: string | null; onClose: () => void; onNote?: (id: string) => void }) {
  const narrow = useNarrow();
  return (
    <Dialog open={url !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent aria-describedby={undefined} data-side={narrow ? "bottom" : undefined} className="flex h-[92dvh] w-[min(46rem,96vw)] max-w-none flex-col gap-0 p-0 sm:max-w-none">
        {url ? <Body url={url} onNote={onNote} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function Body({ url, onNote }: { url: string; onNote?: (id: string) => void }) {
  const q = useQuery({ queryKey: ["reader", url], queryFn: () => reader.read(url), staleTime: HOUR, gcTime: HOUR, retry: false });
  const a = q.data;
  const host = new URL(url).hostname.replace(/^www\./, "");
  const meta = a ? [a.site || host, a.author, a.published, `${readingMinutes(a.words)} min read`].filter(Boolean).join(" · ") : host;
  return (
    <>
      <div className="flex items-center gap-2 border-b border-line py-2 pr-12 pl-4">
        <DialogTitle className="min-w-0 flex-1 truncate text-sm font-semibold">{a?.title || host}</DialogTitle>
        <Button variant="ghost" size="sm" asChild>
          <a href={a?.url ?? url} target="_blank" rel="noreferrer"><ExternalLink /> Open page</a>
        </Button>
      </div>
      <DialogDescription className="sr-only">The page as an article</DialogDescription>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {q.isPending ? (
          <div className="mx-auto flex max-w-2xl flex-col gap-3 px-6 py-8">
            <Skeleton className="h-8 w-3/4" /><Skeleton className="h-4 w-1/3" />
            {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-4 w-full" />)}
          </div>
        ) : q.isError ? (
          <div className="mx-auto flex max-w-2xl flex-col items-start gap-3 px-6 py-10">
            <p className="text-dim text-sm">{message(q.error)}</p>
            <Button variant="outline" size="sm" asChild>
              <a href={url} target="_blank" rel="noreferrer"><ExternalLink /> Open the page instead</a>
            </Button>
          </div>
        ) : a ? (
          <article className="mx-auto max-w-2xl px-6 py-8">
            {a.image && <img src={a.image} alt="" referrerPolicy="no-referrer" className="mb-6 max-h-80 w-full rounded-xl object-cover" onError={(e) => e.currentTarget.remove()} />}
            <h1 className="text-2xl font-semibold leading-tight text-fg">{a.title || host}</h1>
            <p className="mt-2 mb-6 text-faint text-xs">{meta}</p>
            <Markdown body={a.markdown} className="reader" onNote={onNote} />
          </article>
        ) : null}
      </div>
    </>
  );
}
