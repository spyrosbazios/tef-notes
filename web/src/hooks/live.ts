// App-wide data lifecycle, mounted once by the root frame. Feature hooks only read and edit records.
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { live, onRedraw, projectLocal, startRecords } from "@/lib/records";
import { CHATS } from "./agent";
import { PHOTOS } from "./photos";
import { pullPrefs, takePrefs } from "./prefs";

// ---- the feed and the sync

/** Mounted once, in the root frame: the sync's triggers and an open note's typing kept as the page goes (lib/records.ts), the
 *  redraw of the lists after it changes the copy, and what the realtime feed says besides notes, tasks and links (those the sync
 *  takes in itself, in the tab that leads, lib/tab-sync.ts; every tab hears the rest): a new photo refreshes the photo lists, a
 *  chat the chat list, the preferences' record the preferences (hooks/prefs.ts), and a gap in the feed reads the chats and the
 *  preferences again. */
export function useLive() {
  const qc = useQueryClient();
  useEffect(() => {
    let photos: ReturnType<typeof setTimeout> | undefined, chats: ReturnType<typeof setTimeout> | undefined;
    const relist = () => { clearTimeout(chats); chats = setTimeout(() => qc.invalidateQueries({ queryKey: CHATS }), 250); };
    const redraw = onRedraw((topics) => projectLocal(qc, topics));
    const stopSync = startRecords();
    const stop = live((e) => {
      if (e.topic === "attachments") { clearTimeout(photos); photos = setTimeout(() => qc.invalidateQueries({ queryKey: PHOTOS }), 250); }
      else if (e.topic === "chats") relist();
      else if (e.topic === "prefs") takePrefs(e.record);
      else { relist(); void pullPrefs(); }
    });
    return () => { clearTimeout(photos); clearTimeout(chats); stop(); stopSync(); redraw(); };
  }, [qc]);
}
