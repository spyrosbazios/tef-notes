// Talk's voice in Settings (core/prefs.ts `talk`): whose voice it speaks in, picked from the Fish voices the server lists
// (the owner's own first, then public ones, searchable), each with its sample to hear; and how fast it talks. Both are the
// owner's, read by the server at the start of every conversation.
import { useQuery } from "@tanstack/react-query";
import { Check, Loader2, Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { TalkVoice } from "@/core/talk";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { setPrefs, usePrefs } from "@/hooks/prefs";
import { useTalkStatus } from "@/hooks/talk";
import * as talk from "@/services/talk";

/** The paces offered: Fish takes anything from 0.5 to 2, and these are the ones a conversation is worth having at. */
const SPEEDS = [0.8, 0.9, 1, 1.1, 1.25, 1.5] as const;
const speedLabel = (s: number) => `${s}×`;

export function TalkSpeed() {
  const { talk: t } = usePrefs();
  return (
    <div className="space-y-2 px-3 py-2.5">
      <p className="text-sm font-semibold">Speed</p>
      <p className="text-[13px] leading-snug text-dim">How fast the voice talks back. 1× is its natural pace; the next conversation uses it.</p>
      <ToggleGroup type="single" variant="outline" size="sm" aria-label="Speed" value={String(t.speed)}
        onValueChange={(v) => { if (v) setPrefs({ talk: { speed: Number(v) } }); }}>
        {SPEEDS.map((s) => <ToggleGroupItem key={s} value={String(s)} className="tabular-nums">{speedLabel(s)}</ToggleGroupItem>)}
      </ToggleGroup>
    </div>
  );
}

export function TalkVoicePicker() {
  const { talk: t } = usePrefs();
  const status = useTalkStatus().data;
  const [q, setQ] = useState(""), [typed, setTyped] = useState("");
  useEffect(() => { const id = setTimeout(() => setQ(typed.trim()), 300); return () => clearTimeout(id); }, [typed]);
  const list = useQuery({ queryKey: ["talk-voices", q], queryFn: () => talk.voices(q), staleTime: 10 * 60_000 });
  const current = t.voice || status?.voice || "";
  const sample = useSample();
  const pick = (v: TalkVoice) => setPrefs({ talk: { voice: v.id } });
  return (
    <div className="space-y-2 px-3 py-2.5">
      <Label htmlFor="talk-voice-q" className="text-sm font-semibold">Voice</Label>
      <p className="text-[13px] leading-snug text-dim">
        Every reply is spoken in this one voice. Your own voices on fish.audio come first, then public ones; search by name, or paste a voice's id.
        {!t.voice && current ? " None picked yet: the server is using the first one it found." : ""}
      </p>
      <Input id="talk-voice-q" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Search voices" />
      <div className="max-h-72 overflow-y-auto rounded-lg border border-line" role="radiogroup" aria-label="Voice">
        {list.isPending ? <p className="flex items-center gap-2 px-3 py-2.5 text-[13px] text-dim"><Loader2 className="size-4 animate-spin" />Asking Fish…</p>
          : list.isError ? <p className="px-3 py-2.5 text-[13px] text-dim">Fish's voice list didn't answer: {list.error.message}</p>
          : <VoiceRows voices={withPasted(list.data, typed)} current={current} sample={sample} pick={pick} />}
      </div>
    </div>
  );
}

/** A 32-hex id typed into the search is a voice too, even when the list doesn't show it (an unlisted one). */
function withPasted(voices: TalkVoice[], typed: string): TalkVoice[] {
  const id = typed.trim();
  if (!/^[0-9a-f]{32}$/i.test(id) || voices.some((v) => v.id === id)) return voices;
  return [{ id, title: `Voice ${id.slice(0, 8)}…`, languages: [], mine: false }, ...voices];
}

function VoiceRows({ voices, current, sample, pick }: { voices: TalkVoice[]; current: string; sample: Sample; pick: (v: TalkVoice) => void }) {
  if (!voices.length) return <p className="px-3 py-2.5 text-[13px] text-dim">No voice by that name.</p>;
  return (
    <ul className="divide-y divide-line">
      {voices.map((v) => {
        const on = v.id === current;
        return (
          <li key={v.id} className="flex items-center gap-2 px-2 py-1.5">
            <button type="button" role="radio" aria-checked={on} onClick={() => pick(v)}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-muted">
              <Check className={on ? "size-4 shrink-0 text-primary" : "size-4 shrink-0 opacity-0"} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{v.title}</span>
                <span className="block truncate text-[12px] text-dim">{[v.mine ? "Yours" : null, v.languages.join(", ") || null].filter(Boolean).join(" · ")}</span>
              </span>
            </button>
            {v.sample ? (
              <Button type="button" size="icon" variant="ghost" aria-label={sample.playing === v.sample ? `Stop ${v.title}` : `Hear ${v.title}`}
                onClick={() => sample.toggle(v.sample!)}>
                {sample.playing === v.sample ? <Pause className="size-4" /> : <Play className="size-4" />}
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

type Sample = { playing: string | null; toggle: (url: string) => void };

/** One sample at a time: another tap stops it, another voice's replaces it. */
function useSample(): Sample {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  useEffect(() => () => audio.current?.pause(), []);
  const toggle = (url: string) => {
    audio.current?.pause();
    if (playing === url) { setPlaying(null); return; }
    const a = new Audio(url);
    a.onended = () => setPlaying(null);
    audio.current = a;
    setPlaying(url);
    a.play().catch(() => setPlaying(null));
  };
  return { playing, toggle };
}
