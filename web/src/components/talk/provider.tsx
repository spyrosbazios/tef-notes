// Holds Talk above the routes. The assistant's own tools move the app (open_note, go_view) while the conversation goes on, so the
// session (lib/talk-session.ts) can't be a screen's: it is made once here, handed its parts of the app (the chat record, the page's
// context, the UI tools the Ask panel does too, hooks/ui-host.ts), and ended whenever the page goes (`pagehide`) or this unmounts.
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { TALK_RATE } from "@/core/talk";
import { CHATS } from "@/hooks/agent";
import { activeLensOf } from "@/hooks/lens";
import { NOTES } from "@/hooks/notes";
import { prefsNow } from "@/hooks/prefs";
import { TalkContext } from "@/hooks/talk";
import { TASKS } from "@/hooks/todo";
import { openDrawingNow, useNavNow, useUiHost } from "@/hooks/ui-host";
import { pageContext, runUiTool } from "@/lib/assistant";
import { openMic } from "@/lib/mic";
import { createSession, MIC_FRAME } from "@/lib/talk-session";
import { openVoice } from "@/lib/talk-voice";
import { keepAwake } from "@/lib/wake";
import { createChat, newChatId } from "@/services/agent";
import * as talk from "@/services/talk";
import type { NoteRec } from "@/services/notes";
import type { TaskRec } from "@/services/todo";

export function TalkProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const navNow = useNavNow();
  const host = useUiHost(navNow);
  const [session] = useState(() => createSession({
    open: talk.open,
    mic: (onFrame) => openMic({ rate: TALK_RATE.mic, frame: MIC_FRAME, onFrame }),
    voice: openVoice,
    chat: async () => {
      const id = newChatId();
      await createChat(id, `Talk ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
      void qc.invalidateQueries({ queryKey: CHATS });
      return id;
    },
    context: () => {
      const { view, open, task } = navNow.current;
      const notes = qc.getQueryData<NoteRec[]>(NOTES);
      return pageContext({ view, open, task }, { notes, tasks: qc.getQueryData<TaskRec[]>(TASKS) }, "", activeLensOf(qc), false, openDrawingNow(notes));
    },
    writesWithoutAsking: () => prefsNow().agent.unasked,
    tool: (name, input) => runUiTool(name, input, host),
    awake: keepAwake,
    now: Date.now,
  }));

  // The agent saved the conversation to its chat as it went: the list of chats learns of it when it ends
  useEffect(() => {
    let was = session.snapshot().phase;
    return session.subscribe(() => {
      const now = session.snapshot().phase;
      if (was === "live" && now !== "live") void qc.invalidateQueries({ queryKey: CHATS });
      was = now;
    });
  }, [session, qc]);

  useEffect(() => {
    const end = () => session.end();
    addEventListener("pagehide", end);
    return () => { removeEventListener("pagehide", end); end(); };
  }, [session]);

  return <TalkContext value={session}>{children}</TalkContext>;
}
