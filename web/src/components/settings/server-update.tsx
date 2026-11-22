// Settings → Maintenance's server box: the release the server runs, the newest published one with its notes, and updating to
// it with the updater (hooks/release.ts). When the updater can't run here (it is opt-in, or the server is built from source) the
// box says why instead of offering the button.
import { CircleArrowUp, ExternalLink, Loader2, Server } from "lucide-react";
import { useState } from "react";
import { updateOffered } from "@/core/release";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Row, Status } from "@/components/settings/kit";
import { useOnline } from "@/hooks/online";
import { useRelease, useServerUpdate } from "@/hooks/release";

export function ServerUpdate() {
  const online = useOnline();
  const { data: info } = useRelease();
  const { target, doing, error, start } = useServerUpdate();
  const [asking, setAsking] = useState(false);
  if (!info) return null;
  const latest = info.latest;
  const offered = updateOffered(info);
  const why = info.updater.why;
  const tone = target ? "warn" : offered ? "brand" : latest ? "up" : "muted";
  const status = target ? doing : offered ? `${latest!.version} is out` : latest ? "Up to date" : "Couldn't check";
  return (
    <>
      <Row icon={Server} title={<>Server {info.running ? <span className="ml-1 font-normal tabular-nums text-dim">{info.running}</span> : null}</>}
        detail={info.running ? undefined : "A build without a release version"}>
        <Status tone={tone}>{status}</Status>
      </Row>
      {offered && latest && (
        <Row icon={CircleArrowUp} tone="brand" title={`Update to ${latest.version}`} detail={error || why || "Backs up pb_data, then restarts the server."}>
          <Button variant="ghost" size="sm" className="rounded-full" asChild>
            <a href={latest.url} target="_blank" rel="noreferrer"><ExternalLink /> Notes</a>
          </Button>
          {!why && (
            <Button variant="outline" size="sm" className="rounded-full" disabled={!online || !!target} onClick={() => setAsking(true)}>
              {target ? <Loader2 className="animate-spin" /> : <CircleArrowUp />} {target ? "Updating" : "Update"}
            </Button>
          )}
        </Row>
      )}
      <AlertDialog open={asking} onOpenChange={setAsking}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Update the server to {latest?.version}?</AlertDialogTitle>
            <AlertDialogDescription>
              The server stops for a minute or two while pb_data is backed up into backups/ and the new version starts. Edits made
              meanwhile wait on this device and are sent once it is back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (latest) void start(latest.version); }}>Update</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
