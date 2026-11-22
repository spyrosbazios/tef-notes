// Settings → Maintenance's server box: the release the server runs, the newest published one with its notes, and updating to
// it with the updater (hooks/release.ts). When the updater can't run here (it is opt-in, or the server is built from source) the
// box says why instead of offering the button.
import { CircleArrowUp, ExternalLink, Loader2 } from "lucide-react";
import { useState } from "react";
import { updateOffered } from "@/core/release";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Line } from "@/components/settings/line";
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
  const status = target ? doing : offered ? `${latest!.version} is out` : latest ? "Up to date" : "Couldn't check";
  return (
    <>
      <Line title="Server version" detail={info.running ? `Release ${info.running}` : "A build without a release version"}
        trailing={<span className="text-[13px] text-dim">{status}</span>} />
      {offered && latest && (
        <Line title={`Update to ${latest.version}`}
          detail={error || why || "Downloads the release, backs up pb_data, and restarts the server. The app reloads once it is back."}
          trailing={
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" className="rounded-full" asChild>
                <a href={latest.url} target="_blank" rel="noreferrer"><ExternalLink /> Notes</a>
              </Button>
              {!why && (
                <Button variant="outline" size="sm" className="rounded-full" disabled={!online || !!target} onClick={() => setAsking(true)}>
                  {target ? <Loader2 className="animate-spin" /> : <CircleArrowUp />} {target ? "Updating" : "Update"}
                </Button>
              )}
            </div>
          } />
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
