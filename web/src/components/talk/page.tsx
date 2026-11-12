// Talk, a page of its own (`/talk`, routes/_app/talk.tsx): a spoken conversation with the assistant. The orb is the conversation (what
// it is doing, how loud each side is: orb.tsx); beside or under it what was said and done (transcript.tsx, the Ask panel's own
// cards and widgets), and what waits for a tap in the tray, in reach. One obvious action: Start; live, Mute and End, at the bottom where
// a thumb is. The conversation itself is the provider's (provider.tsx), so it goes on while the assistant opens notes and this page
// is left (the pill in pill.tsx brings it back). One column (a phone's, or a window with the assistant's dock beside the page): the orb,
// then the transcript, then the controls (over the tab bar, on a phone); when a card waits on a phone the orb steps back to a small one so
// the card has the room. Where the page itself is wide (a container query, not the window's width, which the dock takes from): the orb and
// controls on the left, the transcript and tray on the right. The time and cost so far are a quiet readout, since whether Talk is worth keeping is what it is here to find out.
import { AutoHeight } from "@animate-ui/react/primitives/effects/auto-height";
import { spring, transition, useTempoTransition } from "@animate-ui/react/utils/motion";
import { AudioLines, Mic, MicOff, PhoneOff, RotateCw, TriangleAlert } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, type ReactNode } from "react";
import { Empty } from "@/components/empty";
import { PageHeader } from "@/components/page-header";
import { Swap } from "@/components/swap";
import { Orb } from "@/components/talk/orb";
import { Tray, Transcript } from "@/components/talk/transcript";
import { Button } from "@/components/ui/button";
import { useNarrow } from "@/hooks/media";
import { useNow } from "@/hooks/now";
import { useTalk, useTalkStatus } from "@/hooks/talk";
import { haptic } from "@/lib/haptics";
import { clock, money, rowsOf, type TalkState } from "@/lib/talk";
import { cn } from "@/lib/utils";

const LABEL: Record<TalkState, string> = {
  idle: "Ready", connecting: "Connecting", listening: "Listening", speaking: "Speaking", working: "Working", waiting: "Waiting for you", failed: "Stopped",
};

/** The time and cost so far, small: `tokens in, tokens out` on hover for whoever wants the detail. */
function Readout() {
  const { startedAt, endedAt, usage } = useTalk();
  const now = useNow(endedAt ? 3_600_000 : 1000);
  if (startedAt == null) return null;
  return (
    <p className="shrink-0 text-xs tabular-nums text-faint" title={usage ? `${usage.input} tokens in, ${usage.output} out` : undefined}>
      {clock(((endedAt ?? now) - startedAt) / 1000)}{usage ? ` · ${money(usage.cost)}` : ""}
    </p>
  );
}

/** What the page says when there is nothing yet: what Talk is, and where the voice and the notes it reads go. */
function About({ model }: { model: string }) {
  return (
    <div className="space-y-1.5 text-center">
      <p className="text-balance text-[15px] leading-snug text-dim">Speak with the assistant and hear it answer, as in Ask. Your voice, and what it reads from your notes to answer, is sent to Google.</p>
      <p className="text-xs text-faint">{model}</p>
    </div>
  );
}

/** A refusal or a failure, with how to put it right. */
function Failure({ message, mic }: { message: string; mic: boolean }) {
  return (
    <div role="alert" className="mx-auto w-full max-w-2xl px-4 pb-3">
      <div className="space-y-1.5 rounded-xl border border-down/40 bg-down/10 p-3">
        <p className="flex items-center gap-2 text-sm font-semibold text-down"><TriangleAlert className="size-4" /> {mic ? "No microphone" : "Talk stopped"}</p>
        <p className="break-words text-[13px] text-dim">{message}</p>
        {mic ? <p className="text-[13px] text-dim">Open this site's settings in the browser (on Android, press and hold the app's icon, then App info, Permissions), allow the microphone, and try again.</p> : null}
      </div>
    </div>
  );
}

/** Start while there is no conversation (Try again after a failure); Mute and End while there is. */
function Controls() {
  const { phase, muted, session } = useTalk();
  const swap = useTempoTransition(transition.swap), pop = useTempoTransition(spring.pop);
  const live = phase === "connecting" || phase === "live";
  const move = { initial: { opacity: 0, scale: 0.92 }, animate: { opacity: 1, scale: 1, transition: { ...pop, opacity: swap } }, exit: { opacity: 0, scale: 0.92, transition: swap } };
  return (
    <div className="relative flex h-14 w-full max-w-sm justify-center">
      <AnimatePresence mode="popLayout" initial={false}>
        {live ? (
          <motion.div key="live" className="flex w-full items-center justify-center gap-3" {...move}>
            <Button variant={muted ? "secondary" : "outline"} size="icon-lg" disabled={phase !== "live"} aria-label={muted ? "Unmute" : "Mute"} aria-pressed={muted} title={muted ? "Unmute" : "Mute"}
              className="size-14 shrink-0 rounded-full [&_svg:not([class*='size-'])]:size-6" onClick={() => { haptic("tap"); session.mute(!muted); }}>
              <Swap id={muted ? "off" : "on"}>{muted ? <MicOff /> : <Mic />}</Swap>
            </Button>
            <Button variant="destructive" className="h-14 min-w-40 flex-1 rounded-full px-6 text-base [&_svg:not([class*='size-'])]:size-5" onClick={() => { haptic("tick"); session.end(); }}>
              <PhoneOff /> End
            </Button>
          </motion.div>
        ) : (
          <motion.div key="start" className="flex w-full justify-center" {...move}>
            <Button className="h-14 w-full max-w-xs rounded-full text-base [&_svg:not([class*='size-'])]:size-5" onClick={() => { haptic("start"); session.start(); }}>
              {phase === "failed" ? <RotateCw /> : <Mic />} {phase === "failed" ? "Try again" : "Start talking"}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** The stage: the orb, and in words what the conversation is doing. When a card waits on a phone, the orb steps back (scaled, and the
 *  stage's height follows on the disclosure's tween) to leave the card the room. */
function Stage({ state, muted, compact }: { state: TalkState; muted: boolean; compact: boolean }) {
  const glide = useTempoTransition(spring.slide);
  const label = state === "listening" && muted ? "Muted" : LABEL[state];
  return (
    <section aria-label="Conversation" data-compact={compact || undefined}
      className={cn("relative grid shrink-0 grid-rows-[minmax(0,1fr)] place-items-center pb-9 transition-[height] duration-[350ms] ease-[cubic-bezier(0.215,0.61,0.355,1)] motion-reduce:transition-none",
        "h-[calc(min(68vw,34dvh)+3rem)] data-compact:h-32 @3xl:col-start-1 @3xl:row-start-1 @3xl:h-auto")}>
      <motion.div initial={false} animate={{ scale: compact ? 0.3 : 1 }} transition={glide} className="w-[min(68vw,34dvh)] @3xl:w-[min(34cqw,24rem,50dvh)]">
        <Orb state={state} muted={muted} className="w-full" />
      </motion.div>
      <p role="status" className={cn("absolute inset-x-0 bottom-0 grid h-9 place-items-center text-sm font-medium", state === "waiting" ? "text-brand" : state === "failed" ? "text-down" : "text-dim")}>
        <Swap id={label}>{label}</Swap>
      </p>
    </section>
  );
}

/** A notice under the transcript opens and closes its own room (the box follows its content). */
function Notice({ id, children }: { id: string; children: ReactNode }) {
  const fade = useTempoTransition(transition.fade);
  return (
    <AutoHeight deps={[id]}>
      <AnimatePresence initial={false} mode="popLayout">
        {children ? <motion.div key={id} initial={{ opacity: 0 }} animate={{ opacity: 1, transition: fade }} exit={{ opacity: 0, transition: fade }}>{children}</motion.div> : null}
      </AnimatePresence>
    </AutoHeight>
  );
}

function Conversation({ model }: { model: string }) {
  const t = useTalk();
  const phone = useNarrow();
  const { rows, pending } = useMemo(() => rowsOf(t.messages), [t.messages]);
  const live = t.phase === "live";
  const waiting = pending.length > 0;
  const tail = t.messages.at(-1);
  return (
    <main className="@container relative h-full min-w-0 flex-1 overflow-hidden">
      <div className="pointer-events-none absolute top-7 left-8 z-10 hidden items-baseline gap-3 md:flex">
        <h1 className="text-3xl font-bold tracking-tight">Talk</h1><Readout />
      </div>
      <div className="flex h-full flex-col @3xl:grid @3xl:grid-cols-[minmax(0,1fr)_minmax(20rem,28rem)] @3xl:grid-rows-[minmax(0,1fr)_auto] @5xl:grid-cols-[minmax(0,1fr)_minmax(26rem,34rem)]">
        <PageHeader title="Talk" icon={<AudioLines className="size-5 shrink-0 text-brand" />} actions={<Readout />} className="md:hidden" />
        <Stage state={t.state} muted={t.muted} compact={phone && waiting} />
        <div className="flex min-h-0 flex-1 flex-col @3xl:col-start-2 @3xl:row-start-1 @3xl:border-l @3xl:border-line">
          <Transcript rows={rows} live={live} state={t.state} newest={tail?.id} empty={<About model={model} />} />
          <Notice id={t.failure ? "failure" : ""}>{t.failure ? <Failure message={t.failure.message} mic={t.failure.mic} /> : null}</Notice>
        </div>
        <div className="@3xl:col-start-2 @3xl:row-start-2 @3xl:border-l @3xl:border-line"><Tray pending={pending} last={tail} /></div>
        <div className="flex shrink-0 justify-center px-5 pt-2 pb-3 max-md:pb-[calc(var(--under-tabs)+0.5rem)] md:pb-8 @3xl:col-start-1 @3xl:row-start-2 @3xl:pb-10">
          <Controls />
        </div>
      </div>
    </main>
  );
}

/** The route's component: Talk where the server has it, and a line saying so where it hasn't. */
export function TalkPage() {
  const status = useTalkStatus(), phone = useNarrow();
  if (status.data) return <Conversation model={status.data.model} />;
  return (
    <main className="flex h-full min-w-0 flex-1 flex-col">
      {phone ? <PageHeader title="Talk" icon={<AudioLines className="size-5 shrink-0 text-brand" />} /> : null}
      <div className="grid min-h-0 flex-1 place-items-center p-6">
        {status.isPending ? null : (
          <Empty icon={AudioLines}>
            <p className="text-sm text-faint">{status.isError ? "The server can't be reached." : "Talk isn't set up on this server."}</p>
          </Empty>
        )}
      </div>
    </main>
  );
}
