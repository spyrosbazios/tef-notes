// The assistant's panel: the conversation with the agent (or, one click away, the saved chats), its message field and the
// model. The conversation is the provider's `Chat` (provider.tsx), shown here over the AI SDK's useChat: the server's stream
// arrives as parts (thoughts, tool calls, text), a note write waits for the owner's yes on a card (the SDK's tool approval)
// and the turn resumes when it is answered. The chat is a server record, made empty on the first send and named in every
// request; the server writes the messages back, so this component keeps none of its own beyond the screen.
import { useChat, type Chat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { ArrowUp, Eye, History, Loader2, SquarePen, Square, Sparkles, TriangleAlert, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChatList } from "@/components/assistant/chat-list";
import { ModelMenu } from "@/components/assistant/model-menu";
import { Turn } from "@/components/assistant/turn";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { SUGGEST } from "@/core/agent";
import type { ChoiceOutput } from "@/core/assistant";
import { useModel } from "@/hooks/agent";
import { useAssistant } from "@/hooks/assistant";
import { setDock } from "@/hooks/dock";
import { useActiveLens } from "@/hooks/lens";
import { useNotes } from "@/hooks/notes";
import { useStick } from "@/hooks/stick";
import { useTasks } from "@/hooks/todo";
import { isTool, type Part } from "@/lib/ask";
import { pageContext } from "@/lib/assistant";
import { titleOf, useNav } from "@/lib/nav";
import { cn } from "@/lib/utils";

const shown = (p: Part) => p.type === "reasoning" || isTool(p) || (p.type === "text" && !!p.text);
const settled = (p: Part) => isTool(p) && (p.state === "output-available" || p.state === "output-error" || p.state === "output-denied");

/** What the assistant sees right now, in a few words: the open note or task, else the list. */
function Seeing() {
  const { view, open, task } = useNav();
  const notes = useNotes().data, tasks = useTasks().data, lens = useActiveLens();
  const c = pageContext({ view, open, task }, { notes, tasks }, "", lens);
  const what = c.note?.title || c.task?.title || titleOf(view);
  return (
    <p className="flex items-center gap-1.5 px-1 pb-1.5 text-xs text-faint" title="The agent sees what you have open">
      <Eye className="size-3.5 shrink-0" /><span className="min-w-0 truncate">{what || "Untitled"}</span>
    </p>
  );
}

function Header({ children }: { children?: ReactNode }) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-1 border-b border-line px-3">
      <Sparkles className="size-4 shrink-0 text-brand" />
      <h2 className="px-1 text-[15px] font-bold tracking-tight">Assistant</h2>
      <div className="flex-1" />
      {children}
      <Button variant="ghost" size="icon" className="text-dim" aria-label="Close the assistant" onClick={() => setDock({ open: false })}><X /></Button>
    </header>
  );
}

function Thread({ chat, onHistory, listing }: { chat: Chat<UIMessage>; onHistory: () => void; listing: boolean }) {
  const { input, setInput, focusKey, send, stop, newChat } = useAssistant();
  const { model, models, unasked } = useModel();
  const { messages, regenerate, status, error, addToolApprovalResponse, addToolOutput } = useChat<UIMessage>({ chat });
  const answer = useCallback((toolCallId: string, output: ChoiceOutput) => { void addToolOutput({ tool: "ask_choice", toolCallId, output }); }, [addToolOutput]);
  const busy = status === "submitted" || status === "streaming";

  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { field.current?.focus(); }, [focusKey]);
  const last = messages[messages.length - 1];
  const asked = last?.role === "assistant" && last.parts.some((p) => isTool(p) && p.state === "approval-requested");   // a card waits for its answer
  const ready = !!model && !asked;

  // Follow the newest line while it is being written, unless the user scrolled up to read
  const { el: scroller, onScroll, follow } = useStick<HTMLDivElement>(messages, status);

  const go = async (raw: string) => {
    const text = raw.trim();
    if (!text || !ready || busy) return;
    setInput("");
    follow();
    if (!(await send(text))) setInput(text);
  };
  const suggest = (s: string) => { if (s.endsWith("?")) void go(s); else { setInput(s.replace(/…$/, " ")); field.current?.focus(); } };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void go(input); }
  };

  // Nothing on screen is moving yet: no reply, or the last thing shown is a finished tool call
  const tail = last?.role === "assistant" ? last.parts.filter(shown).at(-1) : undefined;
  const waiting = busy && (!tail || settled(tail));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Header>
        <ModelMenu disabled={busy} />
        <Button variant={listing ? "secondary" : "ghost"} size="icon" className="shrink-0 text-dim" aria-label="Past chats" aria-pressed={listing} disabled={busy} onClick={onHistory}><History /></Button>
        <Button variant="ghost" size="icon" className="shrink-0 text-dim" aria-label="New chat" disabled={busy || !messages.length} onClick={newChat}><SquarePen /></Button>
      </Header>

      {listing ? <ChatList current={chat.id} idle={!busy} onDone={onHistory} /> : (
        <>
          <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
            <div className="space-y-4 px-4 py-5">
              {!messages.length && (
                <div className="space-y-3 pt-4">
                  <p className="text-sm text-dim">
                    {!model && models ? `The server has no ${models.provider} key yet, so the agent is off.`
                      : `Finds things in your notes, and notes what you tell it. It sees what you have open. ${unasked ? "It writes notes without asking first (Settings)." : "It asks before it writes a note."}`}
                  </p>
                  {model ? (
                    <div className="flex flex-wrap gap-2">
                      {SUGGEST.map((s) => <Button key={s} variant="outline" className="h-auto whitespace-normal rounded-full py-1.5 text-left" onClick={() => suggest(s)}>{s}</Button>)}
                    </div>
                  ) : null}
                </div>
              )}
              {messages.map((m) => (
                <Turn key={m.id} m={m} streaming={status === "streaming" && m === last} live={busy && m === last} last={m === last} respond={addToolApprovalResponse} choose={answer} />
              ))}
              {/* Always there, folded away unless waiting: it fades and closes when the first words land instead of blinking out */}
              <div aria-hidden={!waiting} className={cn("grid transition-[grid-template-rows,opacity] duration-200", waiting ? "grid-rows-[1fr] opacity-100" : "mt-0 grid-rows-[0fr] opacity-0")}>
                <p className="flex items-center gap-2 overflow-hidden text-sm text-dim"><Loader2 className={cn("size-4", waiting && "animate-spin")} /> Thinking…</p>
              </div>
              {error ? (
                <div role="alert" className="space-y-2 rounded-xl border border-down/40 bg-down/10 p-3">
                  <p className="flex items-center gap-2 text-sm font-semibold text-down"><TriangleAlert className="size-4" /> Request failed</p>
                  <p className="break-words text-[13px] text-dim">{error.message}</p>
                  <Button size="sm" variant="secondary" className="rounded-full" disabled={!model} onClick={() => { void regenerate(); }}>Retry</Button>
                </div>
              ) : null}
            </div>
          </div>

          <div className="shrink-0 border-t border-line px-3 py-3">
            <Seeing />
            <div className="flex items-end gap-2 rounded-2xl border border-line bg-card p-2 focus-within:border-ring">
              <Textarea ref={field} autoFocus value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKey} rows={1} disabled={!model}
                placeholder={asked ? "Answer the card above first" : "Ask, or say what to note"}
                className="max-h-48 min-h-9 resize-none border-0 bg-transparent px-2 py-1.5 shadow-none focus-visible:ring-0 dark:bg-transparent" />
              {busy ? (
                <Button size="icon" className="rounded-full transition-transform active:scale-90" aria-label="Stop" onClick={() => { void stop(); }}><Square className="fill-current" /></Button>
              ) : (
                <Button size="icon" className="rounded-full transition-transform active:scale-90" aria-label="Send" disabled={!ready || !input.trim()} onClick={() => { void go(input); }}><ArrowUp /></Button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** The panel's content: `chat` is the provider's, null until the saved one has loaded. */
export function Panel() {
  const { chat, focusKey } = useAssistant();
  // The chat list is open for as long as nothing asks for the field (a handoff's draft brings the thread back)
  const [listedAt, setListedAt] = useState<number>();
  const listing = listedAt === focusKey;
  return (
    <div className="flex h-full min-h-0 flex-col">
      {chat ? <Thread key={chat.id} chat={chat} listing={listing} onHistory={() => setListedAt(listing ? undefined : focusKey)} />
        : <><Header /><div className="space-y-3 p-4"><Skeleton className="h-10 w-2/3" /><Skeleton className="h-24" /></div></>}
    </div>
  );
}
