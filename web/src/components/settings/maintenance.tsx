// Settings → Maintenance: the server, the offline copy this browser keeps, the version.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { TITLE } from "@/components/settings/style";
import { Conflicts, Refused } from "@/components/sync-conflicts";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useOnline } from "@/hooks/online";
import { useSyncStatus } from "@/hooks/sync";
import { clearOffline, keptFiles } from "@/lib/offline";
import { syncNow } from "@/hooks/sync";
import { useTasks } from "@/hooks/todo";
import { useNotes } from "@/hooks/notes";
import { message } from "@/services/api";
import { cn } from "@/lib/utils";
import { builtAt } from "@/lib/persist";
import { appVersion, forceUpdate } from "@/lib/update";
import { Line } from "@/components/settings/line";

/** The server this app talks to, what this browser keeps of it for offline, and clearing that: Maintenance's first box. */
function ServerSync() {
  const qc = useQueryClient();
  const online = useOnline(), { waiting, refused, unsaved, feed } = useSyncStatus(), held = waiting + refused.length;
  const { data: notes } = useNotes(), { data: tasks } = useTasks();
  const files = useQuery({ queryKey: ["offline-files"], queryFn: keptFiles });
  const [asking, setAsking] = useState(false);
  const worker = "serviceWorker" in navigator && !!navigator.serviceWorker.controller;
  const sync = () => { void Promise.all([syncNow(), qc.invalidateQueries()]).then(() => toast("Up to date")); };
  return (
    <>
      <div className="divide-y divide-line rounded-xl border border-line">
        <Line title="Server" detail={location.host} trailing={<span className={cn("text-[13px]", online ? "text-dim" : "text-warn")}>{online ? "Reachable" : "Not reachable"}</span>} />
        <Line title="Live updates" detail={feed ?? "Changes made on other devices show up here within a second."}
          trailing={<span className={cn("text-[13px]", feed ? "text-warn" : "text-dim")}>{feed ? "Off" : online ? "On" : "Waiting"}</span>} />
        <Line title="Sync now" detail="Send waiting changes and fetch what changed."
          trailing={<Button variant="outline" size="sm" className="rounded-full" disabled={!online} onClick={sync}><RefreshCw /> Sync</Button>} />
        <Line title="Offline copy" detail={`${notes?.length ?? 0} notes and ${tasks?.length ?? 0} tasks kept for the next visit${waiting ? ` (${waiting} ${waiting === 1 ? "change" : "changes"} not sent yet)` : ""}${files.data ? `, ${files.data} attachment files` : ""}. ${worker ? "" : "No service worker: only the open page works offline."}${unsaved ? ` ${unsaved}` : ""}`} />
        <Conflicts />
        <Refused />
        <Line title="Clear the offline copy" detail={held ? "Not while changes are waiting to be sent or were refused." : "Forgets what this browser kept. The server is untouched."}
          trailing={<Button variant="outline" size="sm" className="rounded-full" disabled={held > 0} onClick={() => setAsking(true)}><Trash2 /> Clear</Button>} />
      </div>
      <AlertDialog open={asking} onOpenChange={setAsking}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear the offline copy?</AlertDialogTitle>
            <AlertDialogDescription>The app reloads and fetches your notes and tasks from the server again. Offline, nothing will open until you are back online once.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { clearOffline().catch((e) => toast.error(message(e))); }}>Clear</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** The server and the offline copy, which build this is, and fetching a newer one when the update toast hasn't shown up yet. */
export function Maintenance() {
  const online = useOnline();
  const [busy, setBusy] = useState(false);
  const reload = () => { setBusy(true); forceUpdate().catch((e) => { setBusy(false); toast.error(message(e)); }); };
  return (
    <section className="space-y-3" aria-labelledby="maintenance-h">
      <h2 id="maintenance-h" className={TITLE}>Maintenance</h2>
      <ServerSync />
      <div className="divide-y divide-line rounded-xl border border-line">
        <Line title="Version" detail={`Built ${builtAt().toLocaleString()}`} trailing={<span className="text-[13px] text-dim tabular-nums">{appVersion()}</span>} />
        <Line title="Get the latest version" detail="Check for a newer build and reload into it."
          trailing={<Button variant="outline" size="sm" className="rounded-full" disabled={!online || busy} onClick={reload}>{busy ? <Loader2 className="animate-spin" /> : <RefreshCw />} Reload</Button>} />
      </div>
    </section>
  );
}
