// An ask about selected words in a note, made where they are (the selection bar's AI button). The words are held
// (editor/held.ts: marked while the focus is in the field, changed only while unchanged) and what the owner types goes to
// the agent as a chat of its own (hooks/ask-session.ts, a transient chat), with every tool: it changes the words in place or adds
// under them (the selection tools, done by the editor as the owner's own edit, with an Undo here), makes a task of them (its card
// shows here), or answers. A follow-up goes on in the same chat; "Open in chat" hands it to the dock. On a laptop the
// panel opens under the words in place of the bar (selection-bar.tsx); on a phone it is a sheet over the keyboard.
import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { ArrowUp, ArrowUpRight, Loader2, Sparkles, Square, Undo2, X } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ChatReply, type LiveChat } from "@/components/assistant/chat-reply";
import { BottomSheet } from "@/components/bottom-sheet";
import { MicButton } from "@/components/mic-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Editor, Held } from "@/editor";
import { useModel } from "@/hooks/agent";
import { useCloseOutside, type AskSession } from "@/hooks/ask-session";
import { useAssistant } from "@/hooks/assistant";
import { dictateInto } from "@/hooks/dictation";
import { calm } from "@/hooks/media";
import { useStick } from "@/hooks/stick";
import { asking } from "@/lib/ask";
import { keepFocus } from "@/lib/keys";

type PanelProps = {
  session: AskSession;
  send: (text: string) => Promise<boolean>;
  close: (refocus: boolean) => void;
  carry: () => void;
};

/** The reply so far, each question above its answer, and Undo for a change the agent made to the words. */
function Reply({ live, held }: { live: LiveChat; held: Held }) {
  const busy = live.status === "submitted" || live.status === "streaming";
  const { el, onScroll } = useStick<HTMLDivElement>(live.messages, live.status);
  return (
    <div ref={el} onScroll={onScroll} className="max-h-[min(45dvh,22rem)] min-h-0 space-y-3 overflow-y-auto overscroll-contain px-3 py-2">
      <ChatReply live={live} mine="line" working="Working…" />
      {held.canUndo() && !busy ? (
        <Button size="sm" variant="secondary" className="rounded-full" onMouseDown={keepFocus} onClick={() => held.undo()}><Undo2 />Undo the change</Button>
      ) : null}
    </div>
  );
}

/** The panel's content, the same on a laptop and a phone: the words asked about, the reply, the field. One component from
 *  the first message on (the chat it follows changes under it), so the focused field is never swapped for another. */
export function AskPanel({ session, send, close, carry }: PanelProps) {
  const chat = session.chat, live = useChat<UIMessage>(chat ? { chat } : {});
  const { model } = useModel(), { halt } = useAssistant();
  const [text, setText] = useState(""), [sending, setSending] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const held = session.meta;
  const busy = !!chat && (live.status === "submitted" || live.status === "streaming"), asked = !!chat && asking(live.messages.at(-1));

  const go = async () => {
    const t = text.trim();
    if (!t || !model || busy || asked || sending) return;
    setSending(true);
    setText("");
    const ok = await send(t);
    setSending(false);
    if (!ok) setText(t);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); void go(); }
  };
  const quote = held.markdown().replace(/\s+/g, " ").trim();

  return (
    <div data-assistant className="flex min-h-0 flex-col" onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); close(true); } }}>
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-1">
        <Sparkles className="size-4 shrink-0 text-brand" />
        <p className="min-w-0 flex-1 truncate text-xs text-faint" title={quote}>“{quote}”</p>
        {chat ? (
          <Button variant="ghost" size="sm" className="h-7 shrink-0 rounded-full px-2 text-dim" onMouseDown={keepFocus} onClick={carry}><ArrowUpRight />Open in chat</Button>
        ) : null}
        <Button variant="ghost" size="icon-sm" className="shrink-0 text-dim" aria-label="Close" onMouseDown={keepFocus} onClick={() => close(true)}><X /></Button>
      </div>
      {chat ? <Reply live={live} held={held} /> : null}
      <div className="flex items-center gap-1 p-2 pt-1">
        <Input ref={field} autoFocus value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} disabled={!model}
          enterKeyHint="send" aria-label="Ask about the selected text"
          placeholder={!model ? "The agent is off: no model key" : asked ? "Answer the card first" : chat ? "Ask a follow-up" : "Summarize, fix, make it a task…"}
          className="h-9 min-w-0 flex-1 rounded-full border-0 bg-raised px-3.5 shadow-none focus-visible:ring-0" />
        <MicButton onText={(t) => dictateInto(field.current, field.current?.value ?? text, t, setText)} />
        {busy && chat ? (
          <Button size="icon" className="shrink-0 rounded-full" aria-label="Stop" onMouseDown={keepFocus} onClick={() => { void halt(chat); }}><Square className="fill-current" /></Button>
        ) : (
          <Button size="icon" className="shrink-0 rounded-full" aria-label="Send" onMouseDown={keepFocus} disabled={!model || !text.trim() || asked || sending} onClick={() => { void go(); }}>
            {sending ? <Loader2 className="animate-spin" /> : <ArrowUp />}
          </Button>
        )}
      </div>
    </div>
  );
}

/** The phone's ask: a bottom sheet over the keyboard. The held words are scrolled clear of it once the keyboard is up. */
export function AskSheet({ editor, ...props }: PanelProps & { editor: Editor }) {
  const el = useRef<HTMLDivElement>(null);
  useCloseOutside(el, props.session, props.close);
  useEffect(() => {
    const t = setTimeout(() => editor.dom.querySelector(".pm-held")?.scrollIntoView({ block: "center", behavior: calm() ? "instant" : "smooth" }), 350);
    return () => clearTimeout(t);
  }, [editor]);
  return (
    <BottomSheet ref={el} label="Ask about the selected text" onClose={() => props.close(false)}>
      <AskPanel {...props} />
    </BottomSheet>
  );
}

/** The sheet with its exit: present while an ask is open. */
export function PhoneAsk({ editor, session, ...rest }: Omit<PanelProps, "session"> & { editor: Editor; session: AskSession | null }) {
  return <AnimatePresence>{session ? <AskSheet key="ask" editor={editor} session={session} {...rest} /> : null}</AnimatePresence>;
}
