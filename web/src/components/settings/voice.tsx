// Settings → Voice: dictation, and the voice Talk speaks in.
import { useState } from "react";
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
            <p className="text-[13px] leading-snug text-dim">Same engine either way. Free has fair-use limits and no latency promise; paid costs about a cent a minute.</p>
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
