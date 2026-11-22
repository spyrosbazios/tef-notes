// Settings → Voice: dictation; Talk: the voice it speaks in, how fast, and what it thinks with; and what Fish Audio has cost.
import { useQuery } from "@tanstack/react-query";
import { AudioWaveform, CalendarDays, CalendarRange, Cpu, CreditCard, Gift, Mic, Wallet } from "lucide-react";
import { useState } from "react";
import { periodStarts, type FishSpend } from "@/core/fish-usage";
import { TALK_MODEL_LABEL, TALK_MODELS, type TalkModel } from "@/core/talk";
import { clock, money } from "@/lib/talk";
import { fishUsage } from "@/services/talk";
import { ModelMenu } from "@/components/assistant/model-menu";
import { MicButton } from "@/components/mic-button";
import { Group, Page, Row, Segmented, type Option } from "@/components/settings/kit";
import { TalkSpeed, TalkVoicePicker } from "@/components/talk/voice-settings";
import { useTalkModel } from "@/hooks/agent";
import { setPrefs, usePrefs } from "@/hooks/prefs";
import { useTalkOn } from "@/hooks/talk";

/** Voice input: the mic, and where it goes — Fish Audio, not this server's own CPU. */
export function Voice() {
  const [heard, setHeard] = useState("");
  return (
    <Page title="Voice">
      <Group title="Dictation" hint="Speech goes to Fish Audio to be written down; nothing is kept.">
        <Row icon={Mic} title="Try it" detail={heard || "Tap the mic and say something."}><MicButton onText={setHeard} /></Row>
      </Group>
      <TalkVoice />
      <Spending />
    </Page>
  );
}

const modelOf = (m: TalkModel): Option => ({ label: TALK_MODEL_LABEL[m], icon: m === "s2.1-pro-free" ? Gift : CreditCard });

/** Talk's voice (core/prefs.ts `talk`): which model speaks, in whose voice, and how fast. The server speaks through it, so
 *  each is a choice for every screen. */
function TalkVoice() {
  const { talk } = usePrefs();
  const on = useTalkOn();
  const talkChoice = useTalkModel();
  if (!on) return null;
  return (
    <Group title="Talk" hint="Free speaks with fair-use limits; paid is about a cent a minute. Listening is always paid.">
      <Row icon={Cpu} title="Thinks with" detail="Ask's model unless set here."><ModelMenu choice={talkChoice} align="end" /></Row>
      <Row icon={AudioWaveform} title="Voice model">
        <Segmented label="Voice model" value={talk.model} options={TALK_MODELS} of={modelOf} onPick={(m) => setPrefs({ talk: { model: m } })} />
      </Row>
      <TalkSpeed />
      <TalkVoicePicker />
    </Group>
  );
}

/** What Fish Audio has cost this week and this month (core/fish-usage.ts), from the agent's own record, and the credit left. */
function Spending() {
  const starts = periodStarts(new Date());
  const usage = useQuery({ queryKey: ["fish-usage", starts.week, starts.month], queryFn: () => fishUsage(starts), staleTime: 60_000 });
  const u = usage.data;
  if (!u) return null;
  const partly = (from: number) => u.since != null && u.since > from;
  const amount = (v: string) => <span className="text-sm font-semibold tabular-nums">{v}</span>;
  const row = (title: string, icon: typeof Wallet, s: FishSpend, from: number) => (
    <Row icon={icon} title={title} detail={`Talk ${money(s.talk)} · dictation ${money(s.dictation)} · ${clock(s.seconds)} heard${partly(from) ? ` · since ${new Date(u.since ?? 0).toLocaleDateString()}` : ""}`}>
      {amount(money(s.total))}
    </Row>
  );
  return (
    <Group title="Fish Audio spending" hint="At Fish's list prices, counted here, so a few cents off Fish's bill. The free voice costs nothing.">
      {row("This week", CalendarDays, u.week, starts.week)}
      {row("This month", CalendarRange, u.month, starts.month)}
      <Row icon={Wallet} tone={u.balance == null ? "dim" : "brand"} title="Credit left">{amount(u.balance == null ? "Unknown" : money(u.balance))}</Row>
    </Group>
  );
}
