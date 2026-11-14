// A note's opening as markdown, for a list (Home's tiles, a search row): core's `previewOf`, drawn small and inert. The
// tile around it is the button, so a link reads as its words, a checkbox shows its state, and pictures are left to the mosaic.
import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

export const Peek = memo(function Peek({ md, className }: { md: string; className?: string }) {
  return (
    <div className={cn("md peek", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          a: ({ children }) => <span className="peek-link">{children}</span>,
          img: () => null,
          input: (p) => (p.type === "checkbox" ? <input type="checkbox" checked={!!p.checked} readOnly tabIndex={-1} /> : null),
        }}
      >
        {md}
      </ReactMarkdown>
    </div>
  );
});
