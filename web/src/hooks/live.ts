// App-wide data lifecycle, mounted once by the root frame. Feature hooks only read and edit records.
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { heard, onRedraw, startSync, syncNow } from "@/lib/sync";
import { projectLocal } from "@/lib/local-records";
import { watch } from "@/services/realtime";
import { CHATS } from "./agent";
import { PHOTOS } from "./photos";
import { pullPrefs, takePrefs } from "./prefs";

// ---- the feed and the sync

/** Mounted once, in the root frame: the sync's triggers (lib/sync.ts), the redraw of the lists after it changes the copy, and what
 *  the realtime feed says: a note, task or link another device changed is news for the sync (an edit made here echoing back is
 *  not), a new photo refreshes the photo lists, a chat the chat list, the preferences' record the preferences (hooks/prefs.ts). */
export function useLive() {
  const qc = useQueryClient();
  useEffect(() => {
    let photos: ReturnType<typeof setTimeout> | undefined, chats: ReturnType<typeof setTimeout> | undefined;
    const relist = () => { clearTimeout(chats); chats = setTimeout(() => qc.invalidateQueries({ queryKey: CHATS }), 250); };
    const redraw = onRedraw(() => projectLocal(qc));
    const stopSync = startSync();
    const stop = watch({
      onNote: (c) => heard("notes", c.action, c.record),
      onPhoto: () => { clearTimeout(photos); photos = setTimeout(() => qc.invalidateQueries({ queryKey: PHOTOS }), 250); },
      onTask: (c) => heard("tasks", c.action, c.record),
      onLink: (c) => heard("links", c.action, c.record),
      onChat: relist,
      onPrefs: (c) => { if (c.action !== "delete") takePrefs(c.record); },
      onReconnect: () => { void syncNow(); relist(); void pullPrefs(); },
    });
    return () => { clearTimeout(photos); clearTimeout(chats); stop(); stopSync(); redraw(); };
  }, [qc]);
}

