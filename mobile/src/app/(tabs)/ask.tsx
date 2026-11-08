// Ask about your notes, or tell it what to note: the assistant's own tab. The agent runs on the server (src/store/agent.ts);
// this is its window over AI SDK's useChat, the pieces in src/ui/chat. Every request carries the screen the owner was on
// before coming here as its page context, and the UI tools (open_note, go_view, …) take them there (src/agent/ui-tools.ts).
// The keyboard goes down as the reply starts, so the answer can be read.
import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { router, useFocusEffect, useIsFocused } from "expo-router";
import { ChevronRight, History, NotebookPen, Sparkles, SquarePen } from "lucide-react-native";
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { AppState, Keyboard, TextInput, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { held, replied, replying, seen, useService } from "@/agent/background";
import { isAppTool, resumes, runUiTool } from "@/agent/ui-tools";
import { choiceOutput } from "@/core/assistant";
import { SUGGEST } from "@/core/agent";
import { transport, useModel } from "@/store/agent";
import { useChats } from "@/store/chats";
import { usePrefs } from "@/store/prefs";
import { ChatScroller, Composer, Marker, ThinkingDots } from "@/ui/chat";
import { KeepEnd, settled, shown, Turn } from "@/ui/chat/turn";
import { useDictation } from "@/ui/dictation";
import { Banner, Button, Chip, EmptyState, IconButton, ScreenHeader, T } from "@/ui/ds";
import { ModelSheet } from "@/ui/models";
import { useTheme } from "@/ui/use-theme";

const live = held(transport);

/** The ids in order: two copies of a chat that differ here differ in more than a part's state. */
const ids = (ms: UIMessage[]) => ms.map((m) => m.id).join(" ");

export default function Ask() {
  const { C } = useTheme();
  const { model, models } = useModel();
  const unasked = usePrefs((s) => s.agentWritesWithoutAsking);
  const [choosing, setChoosing] = useState(false);
  const [input, setInput] = useState("");
  const { current, open, fresh } = useChats();
  const ready = current.state === "ready" && !!model;
  // A new `id` is a new chat: switching (only while idle) swaps the whole conversation
  const { messages, setMessages, sendMessage, regenerate, status, error, stop, addToolApprovalResponse, addToolOutput } = useChat({
    id: current.id, messages: current.messages, transport: live,
    throttle: 40,
    sendAutomaticallyWhen: resumes,   // a confirm card's answer, or a UI tool done here, resumes the turn
    // A UI tool is done in the app, then answered — always, or the call is closed as an error on the next send. Not awaited.
    // ask_choice is left alone: the owner answers it by tapping (`choose` below)
    onToolCall: ({ toolCall }) => {
      if (toolCall.dynamic || !isAppTool(toolCall.toolName)) return;
      void addToolOutput({ tool: toolCall.toolName, toolCallId: toolCall.toolCallId, output: runUiTool(toolCall.toolName, toolCall.input) });
    },
    // The server saves every reply; this only lets the service go and says so
    onFinish: (f) => replied(replying() ?? current.id, f),
  });
  const choose = useCallback((toolCallId: string, chosen: string[]) => {
    void addToolOutput({ tool: "ask_choice", toolCallId, output: choiceOutput(chosen) });
  }, [addToolOutput]);
  const busy = status === "submitted" || status === "streaming";
  // The reply has started: the keyboard goes, so it can be read
  useEffect(() => { if (status === "streaming") Keyboard.dismiss(); }, [status]);
  // The server's copy of this chat, loaded or changed elsewhere (the laptop), replaces what's shown while idle — unless
  // it's the same messages, as after this phone's own reply, where it could only undo a confirm card's tap not yet sent
  const adopt = useEffectEvent((server: UIMessage[]) => { if (!busy && ids(server) !== ids(messages)) setMessages(server); });
  useEffect(() => { if (current.state === "ready") adopt(current.messages); }, [current]);
  // On screen: opening the tab, or coming back to the app on it, may start a new chat (the newChatOn pref, enterAsk)
  useFocusEffect(useCallback(() => {
    const enter = (via: "tab" | "app") => { if (useChats.getState().enterAsk(!!replying(), via)) setInput(""); };
    enter("tab");
    seen.ask = true;
    const app = AppState.addEventListener("change", (s) => {
      if (s === "active") enter("app");
      else if (s === "background") useChats.getState().leaveAsk();
    });
    return () => { app.remove(); seen.ask = false; useChats.getState().leaveAsk(); useChats.setState({ resumeOnEntry: false }); };
  }, []));

  const field = useRef<TextInput>(null);
  const send = (text: string) => { if (text.trim() && ready) { sendMessage({ text: text.trim() }); setInput(""); } };
  const suggest = (s: string) => (s.endsWith("?") ? send(s) : setInput(s.replace(/…$/, " ")));
  const voice = useDictation(input, setInput);
  const unheld = useService((s) => s.failed);
  const focused = useIsFocused();
  // A message handed over (useChats.startWith: Home's box, a note's box, a share): sent once Ask is in front and idle
  const pending = useChats((s) => s.pending);
  useEffect(() => {
    if (!pending || !ready || busy || !focused) return;
    useChats.setState({ pending: null });
    sendMessage({ text: pending });
  }, [pending, ready, busy, focused, sendMessage]);
  // A draft handed over (a note's "Ask about this note", the Quick widget: useChats.startDraft): into the field, not out
  const draft = useChats((s) => s.draft), [taken, setTaken] = useState<typeof draft>(null);
  if (draft && focused && draft !== taken) { setTaken(draft); setInput(draft.text); }
  useEffect(() => {
    if (!taken) return;
    if (useChats.getState().draft === taken) useChats.setState({ draft: null });
    requestAnimationFrame(() => field.current?.focus());
  }, [taken]);

  const last = messages.at(-1);
  // Nothing on screen is moving yet: no reply, or the last thing shown is a finished tool call
  const tail = last?.role === "assistant" ? last.parts.filter(shown).at(-1) : undefined;
  const waiting = busy && (!tail || settled(tail));
  /** Why nothing can be sent now, with what to do about it. */
  const blocked = current.state === "error" ? { text: `Couldn't load this chat: ${current.err ?? ""}`, act: "Retry", go: () => open(current.id) }
    : models.isError ? { text: `Couldn't reach the agent: ${(models.error as Error).message}`, act: "Retry", go: () => void models.refetch() }
    : models.data && !model ? { text: `The server holds no ${models.data.provider} key yet.`, act: undefined, go: undefined }
    : !models.data && !models.isPending ? { text: "Set the notes server first.", act: "Settings", go: () => router.navigate("/settings") }
    : null;

  return (
    <KeyboardAvoidingView behavior="padding" className="flex-1 bg-bg">
      {/* Idle only, like the buttons: switching a chat mid-reply would cut it off unsaved, and the next message goes to the new model */}
      <ScreenHeader title="Ask" compact
        actions={
          <>
            <IconButton icon={Sparkles} label={`Model: ${model ?? "none"}. Change`} disabled={busy} color={C.dim} onPress={() => setChoosing(true)} />
            <IconButton icon={History} label="Past chats" disabled={busy} color={busy ? C.faint : C.dim} onPress={() => router.push("/chats")} />
            <IconButton icon={SquarePen} label="New chat" disabled={busy || !messages.length} color={busy || !messages.length ? C.faint : C.dim} onPress={fresh} />
          </>
        } />

      {/* keyed by chat: another conversation opens at its end. The scroller keeps room (pb-16) for the jump button */}
      <ChatScroller key={current.id} className="flex-1" contentClassName="gap-5 pt-3">
        {!messages.length && (
          <View className="items-center gap-4 pt-8">
            <EmptyState icon={NotebookPen} title="Ask your notes" className="py-0"
              hint={`Finds things in your notes, notes what you tell it, and opens what it finds. ${unasked ? "It writes notes without asking first (Settings)." : "It asks before it writes a note."}`} />
            {ready && (
              <View className="flex-row flex-wrap justify-center gap-2">
                {SUGGEST.map((s) => (
                  <Chip key={s} label={s} onPress={() => suggest(s)} className="border-transparent bg-raised" />
                ))}
              </View>
            )}
          </View>
        )}
        {messages.map((m) => (
          <Turn key={m.id} m={m} streaming={status === "streaming" && m === last} live={busy && m === last} last={m === last} respond={addToolApprovalResponse} choose={choose} />
        ))}
        {waiting && (
          <Marker icon={<ThinkingDots />} pulse>Thinking…</Marker>
        )}
        {blocked && (
          <View className="gap-2 pt-2">
            <T tone="warn" size={13}>{blocked.text}</T>
            {blocked.act ? (
              <Button variant="outline" size="sm" className="self-start" onPress={blocked.go}>
                <T font="semi" size={14}>{blocked.act}</T>
                <ChevronRight size={16} color={C.dim} />
              </Button>
            ) : null}
          </View>
        )}
        {error && (
          <Banner variant="destructive" title="Request failed" description={error.message}>
            <Button size="sm" variant="tonal" className="self-start" disabled={!ready} onPress={() => regenerate()}>Retry</Button>
          </Banner>
        )}
        <KeepEnd />
      </ChatScroller>

      <View className="px-3 pb-2 pt-1">
        {(voice.err || voice.busy) && <T tone={voice.err ? "warn" : "dim"} size={12} className="px-2 pb-1">{voice.err ?? voice.busy}</T>}
        {busy && unheld && <T tone="warn" size={12} className="px-2 pb-1">Won&apos;t keep going in the background: stay in the app until it answers.</T>}
        <Composer inputRef={field} value={input} onChangeText={setInput} onSubmit={send} onStop={stop} placeholder="Ask, or say what to note"
          onVoice={voice.start} onRecordConfirm={voice.confirm} onRecordCancel={voice.cancel} level={voice.level}
          status={voice.on ? "recording" : busy ? status as "submitted" | "streaming" : "ready"} disabled={!ready || !!voice.busy} />
      </View>
      <ModelSheet open={choosing} onOpenChange={setChoosing} />
    </KeyboardAvoidingView>
  );
}
