// Settings → Voice: dictation, and Talk: the voice it speaks in, how fast, and what it thinks with.
import { AudioWaveform, Cpu, CreditCard, Gift, Mic } from "lucide-react";
import { useState } from "react";
import { TALK_MODEL_LABEL, TALK_MODELS, type TalkModel } from "@/core/talk";
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
