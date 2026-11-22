// Settings → Voice: dictation, and the voice Talk speaks in.
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { periodStarts, type FishSpend } from "@/core/fish-usage";
import { clock, money } from "@/lib/talk";
import { fishUsage } from "@/services/talk";
import { TALK_MODEL_LABEL, TALK_MODELS } from "@/core/talk";
import { ModelMenu } from "@/components/assistant/model-menu";
import { SUB, TITLE } from "@/components/settings/style";
import { MicButton } from "@/components/mic-button";
import { TalkSpeed, TalkVoicePicker } from "@/components/talk/voice-settings";
import { Button } from "@/components/ui/button";
import { useTalkModel } from "@/hooks/agent";
import { setPrefs, usePrefs } from "@/hooks/prefs";
import { useTalkOn } from "@/hooks/talk";
import { Line } from "@/components/settings/line";

/** Voice input: the mic, and where it goes — Fish Audio now, not this server's own CPU. */
export function Voice() {
  const [heard, setHeard] = useState("");
  return (
    <section className="space-y-3" aria-labelledby="voice-h">
      <h2 id="voice-h" className={TITLE}>Voice</h2>
      <p className="text-sm text-dim">Speech is sent to Fish Audio to be written down; the server keeps nothing.</p>
      <div className="divide-y divide-line rounded-xl border border-line">
        <Line title="Try it" detail={heard || "Tap the mic and say something."} trailing={<MicButton onText={setHeard} />} />
      </div>
      <TalkVoice />
      <Spending />
    </section>
  );
}

/** Talk's voice (core/prefs.ts `talk`): which model speaks, in whose voice, and how fast. The server speaks through it, so
 *  each is a choice for every screen. */
function TalkVoice() {
  const { talk } = usePrefs();
  const on = useTalkOn();
  const talkChoice = useTalkModel();
  if (!on) return null;
  return (
    <div className="space-y-3 pt-4">
      <h3 className={SUB}>Talk</h3>
      <div className="divide-y divide-line rounded-xl border border-line">
        <div className="space-y-2.5 px-3 py-2.5">
          <div>
            <p className="text-sm font-semibold">Voice model</p>
            <p className="text-[13px] leading-snug text-dim">Same engine either way. Free has fair-use limits and no latency promise; paid costs about a cent a minute. This is only the speaking side: listening to you is always paid, so Talk and the mic need Fish API credit even on Free.</p>
          </div>
          <div role="radiogroup" aria-label="Voice model" className="flex flex-wrap gap-2">
            {TALK_MODELS.map((m) => (
              <Button key={m} type="button" role="radio" aria-checked={m === talk.model} size="sm" variant={m === talk.model ? "default" : "outline"}
                onClick={() => setPrefs({ talk: { model: m } })}>{TALK_MODEL_LABEL[m]}</Button>
            ))}
          </div>
        </div>
        <TalkVoicePicker />
        <TalkSpeed />
        <div className="flex items-center gap-3 px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Model and effort</p>
            <p className="text-[13px] leading-snug text-dim">What Talk thinks with. Ask's unless set here.</p>
          </div>
          <ModelMenu choice={talkChoice} align="end" />
        </div>
      </div>
    </div>
  );
}

/** What Fish Audio has cost this week and this month (core/fish-usage.ts), from the agent's own record, and the credit left. */
function Spending() {
  const starts = periodStarts(new Date());
  const usage = useQuery({ queryKey: ["fish-usage", starts.week, starts.month], queryFn: () => fishUsage(starts), staleTime: 60_000 });
  const u = usage.data;
  if (!u) return null;
  const partly = (from: number) => u.since != null && u.since > from;
  const row = (title: string, s: FishSpend, from: number) => (
    <Line title={title} detail={`Talk ${money(s.talk)} · dictation ${money(s.dictation)} · ${clock(s.seconds)} listened${partly(from) ? " · counted since " + new Date(u.since ?? 0).toLocaleDateString() : ""}`}
      trailing={<span className="text-sm font-semibold tabular-nums">{money(s.total)}</span>} />
  );
  return (
    <div className="space-y-3 pt-4">
      <h3 className={SUB}>Fish Audio spending</h3>
      <div className="divide-y divide-line rounded-xl border border-line">
        {row("This week", u.week, starts.week)}
        {row("This month", u.month, starts.month)}
        <Line title="Credit left" detail="Fish's own balance." trailing={<span className="text-sm font-semibold tabular-nums">{u.balance == null ? "Unknown" : money(u.balance)}</span>} />
      </div>
      <p className="text-[13px] leading-snug text-faint">At Fish's list prices, worked out by this server from what it sent, so a few cents off Fish's own bill. The free voice costs nothing; listening is always paid.</p>
    </div>
  );
}
