// Holds the assistant above the routes. The `Chat` is made here and lives as long as the page, so navigating never
// unmounts it, closing the dock keeps the thread and the stream going, and a card or a tool call is answered whether or not
// the panel is on screen. What it adds to the plain chat of the AI SDK:
//  - `context` in every request: where the owner is and what is open, read when the request goes out (so a step resumed by
//    an answered card sees the screen as it is then), from the URL's nav, the query cache and the selected text;
//  - the UI tools (core/assistant.ts): a call to open a note, a task or a view is done in the app through the nav
//    and answered with `addToolOutput`, always, even when it fails;
//  - `sendAutomaticallyWhen` (`resumes`): the turn resumes after a card's answer and after a UI tool's answer;
//  - asks from the selection bar (`ask`): each a chat of its own beside the dock's, saved and listed like any, whose
//    context is the words it holds in the note (the selection tools change them); `adopt` hands one to the dock. The
//    dock's own doings (its badge, opening for a card) are for the dock's chat only: an ask shows its reply where it was made.
// The writes the agent makes reach the screen through `useLive` (realtime), as any other client's do.
import { Chat } from "@ai-sdk/react";
import { useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { DefaultChatTransport, type FileUIPart, type UIMessage } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { choiceFrom, isAskTool, isUiTool, uiError, UI_OK, type OpenDrawing } from "@/core/assistant";
import { DRAWING_LIMITS } from "@/core/drawing";
import { isDrawing } from "@/core/photos";
import { newChatDue } from "@/core/prefs";
import { chatTitle } from "@/core/share";
import { CHATS, settingsNow } from "@/hooks/agent";
import { AssistantContext, type Assistant } from "@/hooks/assistant";
import { answered } from "@/hooks/ask-badge";
import { dockNow, onDock, setDock } from "@/hooks/dock";
import { keepPicture, liveFor, liveNow, openDrawing, openedNow } from "@/hooks/drawing";
import { photoListQuery } from "@/hooks/photos";
import { prefsNow } from "@/hooks/prefs";
import { activeLensOf } from "@/hooks/lens";
import { NOTES } from "@/hooks/notes";
import { persisted } from "@/hooks/store";
import { TASKS } from "@/hooks/todo";
import type { Held } from "@/editor";
import { closeUnfinished, pageContext, resumes, runUiTool, type UiHost } from "@/lib/assistant";
import { isTool } from "@/lib/ask";
import { useNav } from "@/lib/nav";
import { syncNow } from "@/lib/sync";
import { STORAGE } from "@/lib/storage-keys";
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

/** The drawing open in the editor, as the context carries it; undefined when none is, or its note isn't in the cache. */
function openDrawingNow(notes: NoteRec[] | undefined): OpenDrawing | undefined {
  const l = liveNow(), n = l && notes?.find((x) => x.note.id === l.noteId);
  if (!l || !n) return undefined;
  const { shapes, selected } = l.shapes(), shown = shapes.slice(0, DRAWING_LIMITS.shown);
  return {
    path: n.path, ...(l.name ? { name: l.name } : {}), shapes: shown, ...(shapes.length > shown.length ? { more: shapes.length - shown.length } : {}),
    ...(selected.length ? { selected } : {}), ...(l.unsaved() ? { unsaved: true as const } : {}),
  };
}

/** Stop the reply, and close the calls it left open (lib/assistant.ts `closeUnfinished` says why). */
async function halt(chat: Chat<UIMessage>) {
  await chat.stop();
  chat.messages = closeUnfinished(chat.messages);
}

// When the dock was last on screen (kept across a reload) and whether the app was left since: a page loaded fresh counts as
// left, so a killed PWA does too
const chatSeen = persisted<{ at: number }>(STORAGE.chatSeen, (p) => ({ at: typeof p.at === "number" ? p.at : 0 }));
const seen = {
  left: true,
  at: () => chatSeen.read().at,
  mark: () => chatSeen.replace({ at: Date.now() }),
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
      // Below `md` the dock covers the page, but a navigation leaves the Ask step (dock.tsx `useAskStep`), uncovering what was opened
      openNote: (id) => navNow.current.openNote(id),
      showTask: (v, id) => navNow.current.showTask(v, id),
      goView: (v) => navNow.current.goView(v),
    },
    showAssistant: () => setDock({ open: true }),
    // The drawing named (else the one open over the note, else a new one) opens over its note, and the edit is made on it, unsaved
    draw: async ({ path, name, add, update, remove }, call) => {
      const n = await find<NoteRec>(qc, NOTES, (x) => x.path === path);
      if (!n) return uiError(`No note ${path}.`);
      const id = n.note.id;
      if (name) {
        const there = (await qc.fetchQuery(photoListQuery(id))).filter((p) => isDrawing(p.name)).map((p) => p.name);
        if (!there.includes(name)) return uiError(`${path} has no drawing ${name}${there.length ? ` (it has ${there.join(", ")})` : ""}. Leave the name out to start a new one.`);
      }
      const o = openedNow(), same = !!o && o.noteId === id && (!name || o.name === name);
      if (o && !same && liveNow()?.unsaved()) return uiError("Another drawing is open with changes not saved yet: ask the owner to save or close it first. Nothing was drawn.");
      navNow.current.openNote(id);
      const live = await liveFor(same ? o.seq : openDrawing(id, name ?? null));
      if (!live) return uiError("The drawing editor didn't open in time. Nothing was drawn.");
      const r = await live.apply({ add, update, remove });
      if ("error" in r) return uiError(`${r.error} Nothing was drawn.`);
      if (r.picture) keepPicture(call, r.picture);
      return UI_OK;
    },
  }), [qc]);

  // The dock's chat, for the callbacks of every chat (an ask's included) to tell it apart
  const docked = useRef<Chat<UIMessage> | null>(null);

  /** A chat; `held`: an ask's, the words it holds while it does (null once let go: a plain chat from then on). */
  const build = useCallback((id: string, messages: UIMessage[], held?: () => Held | null): Chat<UIMessage> => {
    const chat: Chat<UIMessage> = new Chat<UIMessage>({
      id, messages,
      transport: new DefaultChatTransport<UIMessage>({
        api: "/agent/chat",
        prepareSendMessagesRequest: ({ id, messages }) => {
          const { view, open, task } = navNow.current, words = held?.();
          const context = pageContext({ view, open, task }, {
            notes: qc.getQueryData<NoteRec[]>(NOTES), tasks: qc.getQueryData<TaskRec[]>(TASKS),
          }, words ? words.markdown() : selected.current, activeLensOf(qc), !!words, openDrawingNow(qc.getQueryData<NoteRec[]>(NOTES)));
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
        void runUiTool(toolName, toolCall.input, held ? { ...host, held } : host, toolCallId)
          .catch((e: unknown) => uiError(message(e)))
          .then((output) => {
            const open = chat.lastMessage?.parts.some((p) => isTool(p) && p.toolCallId === toolCallId && p.state === "input-available");
            if (open) return chat.addToolOutput({ tool: toolName, toolCallId, output });
          });
      },
      onFinish: ({ message: m, isAbort, isError, isDisconnect }) => {
        void qc.invalidateQueries({ queryKey: CHATS });
        if (docked.current !== chat) return;
        if (!isAbort) answered();
        // A card waits for its answer: a closed dock would leave the write waiting with nobody to see it
        if (!isAbort && !isError && !isDisconnect && m.parts.some((p) => isTool(p) && p.state === "approval-requested")) setDock({ open: true });
      },
    });
    return chat;
  }, [qc, host]);

  const [chat, setChat] = useState<Chat<UIMessage> | null>(null);
  useEffect(() => { docked.current = chat; }, [chat]);
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
  // dock was opened for that conversation (a card, a UI tool), not by the owner for a new one; nor when it opens on a
  // chat handed to it (`handed`, `adopt`)
  const handed = useRef(false);
  const latest = useRef({ chat, newChat });
  useEffect(() => { latest.current = { chat, newChat }; });
  useEffect(() => {
    let wasOpen = dockNow().open;
    const enter = () => {
      const { chat: c, newChat: fresh } = latest.current, left = seen.left;
      seen.left = false;
      if (handed.current) { handed.current = false; return; }
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

  const ask = useCallback(async (text: string, held: () => Held | null) => {
    const id = newChatId();
    try { await createChat(id, chatTitle(text)); } catch (e) { toast.error(message(e)); return null; }
    made.current.add(id);
    void qc.invalidateQueries({ queryKey: CHATS });
    const c = build(id, [], held);
    void c.sendMessage({ text });
    return c;
  }, [build, qc]);

  const adopt = useCallback((c: Chat<UIMessage>) => {
    opening.current++;
    if (!dockNow().open) handed.current = true;
    setChat(c);
    setDock({ open: true, chat: c.id });
    setFocusKey((k) => k + 1);
  }, []);

  const value = useMemo<Assistant>(() => ({ chat, input, setInput, focusKey, show, send, stop, newChat, openChat, ask, adopt, halt }),
    [chat, input, focusKey, show, send, stop, newChat, openChat, ask, adopt]);
  return <AssistantContext value={value}>{children}</AssistantContext>;
}
