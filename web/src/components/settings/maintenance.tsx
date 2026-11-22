// Settings → Maintenance: the server and the sync, the offline copy this browser keeps, the app's version and updating the server.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppWindow, HardDrive, Loader2, Radio, RefreshCw, Server, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Group, Page, Pill, Row, Status } from "@/components/settings/kit";
import { ServerUpdate } from "@/components/settings/server-update";
import { Conflicts, Refused } from "@/components/sync-conflicts";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useOnline } from "@/hooks/online";
import { syncNow, useSyncStatus } from "@/hooks/sync";
import { useTasks } from "@/hooks/todo";
import { useNotes } from "@/hooks/notes";
import { clearOffline, keptFiles } from "@/lib/offline";
import { builtAt } from "@/lib/persist";
import { appVersion, forceUpdate } from "@/lib/update";
import { message } from "@/services/api";

/** The server this app talks to, whether its live feed is on, sending and fetching now, and what is stuck. */
function Sync() {
  const qc = useQueryClient();
  const online = useOnline(), { waiting, feed } = useSyncStatus();
  const sync = () => { void Promise.all([syncNow(), qc.invalidateQueries()]).then(() => toast("Up to date")); };
  return (
    <Group title="Sync">
      <Row icon={Server} title="Server" detail={location.host}>
        <Status tone={online ? "up" : "down"}>{online ? "Reachable" : "Not reachable"}</Status>
      </Row>
      <Row icon={Radio} title="Live updates" detail={feed ?? undefined}>
        <Status tone={feed ? "warn" : online ? "up" : "muted"}>{feed ? "Off" : online ? "On" : "Waiting"}</Status>
      </Row>
      <Row icon={RefreshCw} title="Sync now" detail={waiting ? `${waiting} ${waiting === 1 ? "change" : "changes"} waiting` : undefined}>
        <Button variant="outline" size="sm" className="rounded-full" disabled={!online} onClick={sync}><RefreshCw /> Sync</Button>
      </Row>
      <Conflicts />
      <Refused />
    </Group>
  );
}

/** What this browser keeps for offline, and forgetting it. */
function OfflineCopy() {
  const { waiting, refused, unsaved } = useSyncStatus(), held = waiting + refused.length;
  const { data: notes } = useNotes(), { data: tasks } = useTasks();
  const files = useQuery({ queryKey: ["offline-files"], queryFn: keptFiles });
  const [asking, setAsking] = useState(false);
  const worker = "serviceWorker" in navigator && !!navigator.serviceWorker.controller;
  const warning = [worker ? null : "No service worker: only the open page works offline.", unsaved || null, held ? "Clearing waits until every change is sent." : null].filter(Boolean).join(" ");
  return (
    <>
      <Group title="Offline copy" hint="Clearing forgets what this browser kept; the server is untouched.">
        <Row icon={HardDrive} title="This browser" detail={warning || undefined}
          below={
            <div className="flex flex-wrap gap-1.5 pl-11">
              <Pill>{notes?.length ?? 0} notes</Pill>
              <Pill>{tasks?.length ?? 0} tasks</Pill>
              {files.data ? <Pill>{files.data} files</Pill> : null}
            </div>
          }>
          <Button variant="outline" size="sm" className="rounded-full" disabled={held > 0} onClick={() => setAsking(true)}><Trash2 /> Clear</Button>
        </Row>
      </Group>
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

/** Which build this is, fetching a newer one when the update toast hasn't shown up yet, and the server's release. */
function Versions() {
  const online = useOnline();
  const [busy, setBusy] = useState(false);
  const reload = () => { setBusy(true); forceUpdate().catch((e) => { setBusy(false); toast.error(message(e)); }); };
  return (
    <Group title="Version">
      <Row icon={AppWindow} title={<>App <span className="ml-1 font-normal tabular-nums text-dim">{appVersion()}</span></>} detail={`Built ${builtAt().toLocaleString()}`}>
        <Button variant="outline" size="sm" className="rounded-full" disabled={!online || busy} onClick={reload}>{busy ? <Loader2 className="animate-spin" /> : <RefreshCw />} Reload</Button>
      </Row>
      <ServerUpdate />
    </Group>
  );
}

export function Maintenance() {
  return (
    <Page title="Maintenance">
      <Sync />
      <OfflineCopy />
      <Versions />
    </Page>
  );
}
