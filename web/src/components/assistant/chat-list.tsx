// The saved chats, newest activity first: pick one to carry on where it stopped, or delete it. Kept on the server,
// so the phone's chats are these too.
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ago } from "@/core/time";
import { useChats, useRemoveChat } from "@/hooks/agent";
import { useAssistant } from "@/hooks/assistant";
import { useNow } from "@/hooks/now";
import { ms } from "@/lib/search";
import { cn } from "@/lib/utils";
import { message } from "@/services/api";
import type { ChatRec } from "@/services/agent";

/** `current`: the open chat. `idle`: false while a reply is coming, which switching would cut off. `onDone`: a chat was picked. */
export function ChatList({ current, idle, onDone }: { current: string; idle: boolean; onDone: () => void }) {
  const { openChat, newChat } = useAssistant();
  const { data, isPending, isError } = useChats();
  const remove = useRemoveChat();
  const now = useNow(30_000);
  const [removing, setRemoving] = useState<ChatRec>();

  const confirm = async () => {
    if (!removing) return;
    try { await remove.mutateAsync(removing.id); if (removing.id === current) newChat(); } catch (e) { toast.error(message(e)); }
    setRemoving(undefined);
  };

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Chats">
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {isPending ? Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="mb-1.5 h-12 rounded-lg" />)
          : isError ? <p className="px-3 py-8 text-center text-sm text-down">The chats can't be loaded.</p>
          : data.length ? (
            <ul>
              {data.map((c) => (
                <li key={c.id} className="group relative">
                  <button type="button" disabled={!idle && c.id !== current} onClick={() => { if (c.id === current) onDone(); else openChat(c.id); }} aria-current={c.id === current ? "true" : undefined}
                    className={cn("flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 pr-10 text-left transition-colors disabled:opacity-50",
                      c.id === current ? "bg-accent" : "hover:bg-muted")}>
                    <span className={cn("truncate text-sm font-semibold", c.id === current && "text-brand")}>{c.title || "Untitled"}</span>
                    <span className="text-[11px] tabular-nums text-faint">{ago(ms(c.updated), now)}</span>
                  </button>
                  <Button variant="ghost" size="icon-sm" aria-label={`Delete ${c.title}`} disabled={!idle && c.id === current} onClick={() => setRemoving(c)}
                    className="absolute right-1 top-1/2 -translate-y-1/2 text-dim opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 any-pointer-coarse:opacity-100">
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          ) : <p className="px-3 py-8 text-center text-sm text-faint">No saved chats yet. A chat lands here with its first message.</p>}
      </div>
      <AlertDialog open={!!removing} onOpenChange={(o) => { if (!o) setRemoving(undefined); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{removing?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>The chat goes from every device. Notes it wrote stay.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirm}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
