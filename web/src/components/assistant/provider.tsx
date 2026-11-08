// Holds the assistant above the routes. The `Chat` is made here and lives as long as the page, so navigating never
// unmounts it, closing the dock keeps the thread and the stream going, and a card or a tool call is answered whether or not
// the panel is on screen. What it adds to the plain chat of the AI SDK:
//  - `context` in every request: where the owner is and what is open, read when the request goes out (so a step resumed by
//    an answered card sees the screen as it is then), from the URL's nav, the query cache and the selected text;
//  - the UI tools (core/assistant.ts): a call to open a note, a task or a view is done in the app through the nav
//    and answered with `addToolOutput`, always, even when it fails;
//  - `sendAutomaticallyWhen` (`resumes`): the turn resumes after a card's answer and after a UI tool's answer.
// The writes the agent makes reach the screen through `useLive` (realtime), as any other client's do.
import { Chat } from "@ai-sdk/react";
import { useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { DefaultChatTransport, type FileUIPart, type UIMessage } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { choiceFrom, isAskTool, isUiTool, uiError } from "@/core/assistant";
import { newChatDue } from "@/core/prefs";
import { chatTitle } from "@/core/share";
import { CHATS, settingsNow } from "@/hooks/agent";
import { AssistantContext, type Assistant } from "@/hooks/assistant";
import { answered } from "@/hooks/ask-badge";
import { dockNow, onDock, setDock } from "@/hooks/dock";
import { prefsNow } from "@/hooks/prefs";
import { activeLensOf } from "@/hooks/lens";
import { NOTES } from "@/hooks/notes";
import { TASKS } from "@/hooks/todo";
import { closeUnfinished, pageContext, resumes, runUiTool, type UiHost } from "@/lib/assistant";
import { isTool } from "@/lib/ask";
import { useNav } from "@/lib/nav";
import { syncNow } from "@/lib/sync";
import { message } from "@/services/api";
import { chat as loadChat, createChat, newChatId } from "@/services/agent";
import type { NoteRec } from "@/services/notes";
import type { TaskRec } from "@/services/todo";

/** A record from the cache, else from the server (the agent may have just made it and the live feed not yet told us): a sync brings
 *  it into the local copy, and so into the cache. */
async function find<T>(qc: QueryClient, key: QueryKey, is: (r: T) => boolean): Promise<T | undefined> {
  const held = () => qc.getQueryData<T[]>(key)?.find(is);
  if (held()) return held();
  await syncNow();
  return held();
}

/** Below `md` the dock covers the whole page: what the agent opened would stay hidden behind it, so it steps aside. */
const uncover = () => { if (!matchMedia("(min-width: 768px)").matches) setDock({ open: false }); };

/** Stop the reply, and close the calls it left open (lib/assistant.ts `closeUnfinished` says why). */
async function halt(chat: Chat<UIMessage>) {
  await chat.stop();
  chat.messages = closeUnfinished(chat.messages);
}

// When the dock was last on screen (kept across a reload) and whether the app was left since: a page loaded fresh counts as
// left, so a killed PWA does too
const SEEN = "tefnotes.chat-seen";
const seen = {
  left: true,
  at: () => { try { return Number(localStorage.getItem(SEEN)) || 0; } catch { return 0; } },
  mark: () => { try { localStorage.setItem(SEEN, String(Date.now())); } catch { /* storage unavailable */ } },
};

export function AssistantProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const nav = useNav();
  const navNow = useRef(nav);
  useEffect(() => { navNow.current = nav; });

  // The text selected on the page, kept while the owner clicks into the dock (which would clear the browser's own)
  const selected = useRef("");
  useEffect(() => {
    const track = () => {
      const s = getSelection(), at = s?.anchorNode;
      if (!s || (at instanceof Element ? at : at?.parentElement)?.closest("[data-assistant]")) return;
      selected.current = s.isCollapsed ? "" : s.toString();
    };
    document.addEventListener("selectionchange", track);
    return () => document.removeEventListener("selectionchange", track);
  }, []);

  const host = useMemo<UiHost>(() => ({
    note: (path) => find<NoteRec>(qc, NOTES, (n) => n.path === path),
    task: (id) => find<TaskRec>(qc, TASKS, (t) => t.id === id),
    nav: {
      openNote: (id) => { navNow.current.openNote(id); uncover(); },
      showTask: (v, id) => { navNow.current.showTask(v, id); uncover(); },
      goView: (v) => { navNow.current.goView(v); uncover(); },
    },
    showAssistant: () => setDock({ open: true }),
  }), [qc]);

  const build = useCallback((id: string, messages: UIMessage[]): Chat<UIMessage> => {
    const chat: Chat<UIMessage> = new Chat<UIMessage>({
      id, messages,
      transport: new DefaultChatTransport<UIMessage>({
        api: "/agent/chat",
        prepareSendMessagesRequest: ({ id, messages }) => {
          const { view, open, task } = navNow.current;
          const context = pageContext({ view, open, task }, {
            notes: qc.getQueryData<NoteRec[]>(NOTES), tasks: qc.getQueryData<TaskRec[]>(TASKS),
          }, selected.current, activeLensOf(qc));
          return { body: { id, messages, ...settingsNow(qc), context } };
        },
      }),
      sendAutomaticallyWhen: resumes,
      onToolCall: ({ toolCall }) => {
        const { toolName, toolCallId } = toolCall;
        if (!isUiTool(toolName)) return;
        // The question is the owner's to answer (choice.tsx); one that can never be drawn is answered here, so the call isn't left open
        if (isAskTool(toolName)) {
          if (!choiceFrom(toolCall.input)) return chat.addToolOutput({ tool: toolName, toolCallId, output: uiError("The question was malformed: it needs a question and 2 to 6 options.") });
          return;
        }
        // Not awaited (the SDK's rule); answered once the app has done it, unless a Stop closed the call meanwhile
        void runUiTool(toolName, toolCall.input, host)
          .catch((e: unknown) => uiError(message(e)))
          .then((output) => {
            const open = chat.lastMessage?.parts.some((p) => isTool(p) && p.toolCallId === toolCallId && p.state === "input-available");
            if (open) return chat.addToolOutput({ tool: toolName, toolCallId, output });
          });
      },
      onFinish: ({ message: m, isAbort, isError, isDisconnect }) => {
        void qc.invalidateQueries({ queryKey: CHATS });
        if (!isAbort) answered();
        // A card waits for its answer: a closed dock would leave the write waiting with nobody to see it
        if (!isAbort && !isError && !isDisconnect && m.parts.some((p) => isTool(p) && p.state === "approval-requested")) setDock({ open: true });
      },
    });
    return chat;
  }, [qc, host]);

  const [chat, setChat] = useState<Chat<UIMessage> | null>(null);
  const made = useRef(new Set<string>());                    // the chats the server has a record of
  const opening = useRef(0);                                  // which openChat is the latest, so a slow one can't land late

  // The current chat comes back on a reload; one that is gone (deleted on another device) starts a new one
  useEffect(() => {
    let current = true;
    const id = dockNow().chat, fresh = () => { if (current) setChat(build(newChatId(), [])); };
    if (!id) { fresh(); return () => { current = false; }; }
    loadChat(id).then((c) => {
      if (!current) return;
      if (!c) { setDock({ chat: undefined }); fresh(); return; }
      made.current.add(id);
      setChat(build(id, closeUnfinished(c.messages)));
    }, fresh);
    return () => { current = false; };
  }, [build]);

  // `focusKey` counts the asks for the field: a new chat, a chat opened, a handoff (and the panel leaves the chat list for it)
  const [input, setInput] = useState(""), [focusKey, setFocusKey] = useState(0);

  const newChat = useCallback(() => {
    opening.current++;
    setDock({ chat: undefined });
    setChat(build(newChatId(), []));
    setFocusKey((k) => k + 1);
  }, [build]);

  // The dock back on screen (opened, or the app come back to with it open) starts a new chat when the owner's setting says
  // it is due (core/prefs.ts `newChatDue`); the last one stays in the list. Not while a reply runs or a card waits: then the
  // dock was opened for that conversation (a card, a UI tool), not by the owner for a new one
  const latest = useRef({ chat, newChat });
  useEffect(() => { latest.current = { chat, newChat }; });
  useEffect(() => {
    let wasOpen = dockNow().open;
    const enter = () => {
      const { chat: c, newChat: fresh } = latest.current, left = seen.left;
      seen.left = false;
      if (!c?.messages.length || c.status === "submitted" || c.status === "streaming") return;
      if (c.lastMessage?.parts.some((p) => isTool(p) && p.state === "approval-requested")) return;
      if (newChatDue(prefsNow().agent.newChat, left, seen.at(), Date.now())) fresh();
    };
    const off = onDock(() => {
      const open = dockNow().open;
      if (open && !wasOpen) enter();
      if (!open && wasOpen) seen.mark();
      wasOpen = open;
    });
    const vis = () => {
      if (document.visibilityState === "hidden") { seen.left = true; if (dockNow().open) seen.mark(); }
      else if (dockNow().open) enter();
    };
    document.addEventListener("visibilitychange", vis);
    return () => { off(); document.removeEventListener("visibilitychange", vis); };
  }, []);

  const openChat = useCallback((id: string) => {
    const mine = ++opening.current;
    loadChat(id).then((c) => {
      if (mine !== opening.current) return;
      if (!c) { toast.error("That chat is gone: deleted on another device."); void qc.invalidateQueries({ queryKey: CHATS }); return; }
      made.current.add(id);
      setDock({ chat: id });
      setChat(build(id, closeUnfinished(c.messages)));
      setFocusKey((k) => k + 1);
    }, (e: unknown) => { if (mine === opening.current) toast.error(message(e)); });
  }, [build, qc]);

  const show = useCallback((draft?: string) => {
    setDock({ open: true });
    if (draft != null) setInput(draft);
    setFocusKey((k) => k + 1);
  }, []);

  const send = useCallback(async (raw: string, files: FileUIPart[] = []) => {
    const text = raw.trim();
    if (!chat || (!text && !files.length)) return false;
    if (!made.current.has(chat.id)) {
      try { await createChat(chat.id, chatTitle(text || files[0].filename || "Attachment")); } catch (e) { toast.error(message(e)); return false; }
      made.current.add(chat.id);
      setDock({ chat: chat.id });
      void qc.invalidateQueries({ queryKey: CHATS });
    }
    void chat.sendMessage(text ? { text, files } : { files });
    return true;
  }, [chat, qc]);

  const stop = useCallback(async () => { if (chat) await halt(chat); }, [chat]);

  const value = useMemo<Assistant>(() => ({ chat, input, setInput, focusKey, show, send, stop, newChat, openChat }),
    [chat, input, focusKey, show, send, stop, newChat, openChat]);
  return <AssistantContext value={value}>{children}</AssistantContext>;
}
