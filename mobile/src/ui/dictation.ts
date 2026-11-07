// Speech to text for a composer, on the phone: 16 kHz mono PCM from the mic, NVIDIA Parakeet TDT
// (via whisper.rn) over it when the user confirms. No speech service, no network after the one-time
// model download. Confirm drops the words into the field for editing; cancel discards the take.
import LiveAudioStream from "@fugood/react-native-audio-pcm-stream";
import { Directory, File, Paths } from "expo-file-system";
import * as Haptics from "expo-haptics";
import { useIsFocused } from "expo-router";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Alert, AppState, PermissionsAndroid } from "react-native";
import { initParakeet, type ParakeetContext } from "whisper.rn/index";   // the package exports subpaths only

// Parakeet TDT 0.6B: more accurate on English than Whisper small and far faster — it doesn't decode
// token by token. Whisper base.en was fast but too inaccurate; small too slow.
const MODEL = "ggml-parakeet-tdt-0.6b-v3-q4_0.bin";
const OLD = ["ggml-small-q5_1.bin", "ggml-base.en-q5_1.bin"];   // earlier models, deleted to free the space
const MODEL_URL = `https://huggingface.co/ggml-org/parakeet-GGUF/resolve/main/${MODEL}`;
const MODEL_MB = 356;
const RATE = 16_000;
const MAX_S = 60;                                      // plenty for a message
const IDLE_MS = 3 * 60_000;                            // then the ~0.4 GB context is freed; the next take reloads it

let ctx: Promise<ParakeetContext> | null = null, idle: ReturnType<typeof setTimeout> | undefined, transcribing = false;
// The stream's `on` adds a listener per call, so wire it once and point it at the live recording.
let sink: ((b64: string) => void) | null = null, wired = false;
const dir = () => new Directory(Paths.document, "whisper");   // named for the first model; renaming it orphans the download
const modelFile = () => new File(dir(), MODEL);
const partFile = () => new File(dir(), `${MODEL}.part`);     // renamed to MODEL only when complete, so start() can trust it

const context = () => {
  clearTimeout(idle);
  return (ctx ??= initParakeet({ filePath: modelFile().uri }).catch((e) => {
    ctx = null;
    try { modelFile().delete(); } catch {}            // a model that won't load is re-downloaded on the next start
    throw e;
  }));
};

function release() {
  clearTimeout(idle);
  if (transcribing || !ctx) return;
  const c = ctx;
  ctx = null;
  c.then((x) => x.release()).catch(() => {});
}
const releaseLater = () => { clearTimeout(idle); idle = setTimeout(release, IDLE_MS); };

export function useDictation(text: string, setText: (t: string) => void) {
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);   // "Downloading 40%" / "Transcribing…"
  const [level, setLevel] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const chunks = useRef<Uint8Array[]>([]), bytes = useRef(0), live = useRef(false);

  const download = async () => {
    if (!dir().exists) dir().create();
    const part = partFile();
    if (part.exists) part.delete();
    const task = File.createDownloadTask(MODEL_URL, part, {
      onProgress: ({ bytesWritten, totalBytes }: { bytesWritten: number; totalBytes: number }) => setBusy(`Downloading voice model ${Math.round((bytesWritten / (totalBytes || MODEL_MB * 1e6)) * 100)}%`),
    });
    if (!(await task.downloadAsync())) throw new Error("interrupted");
    part.rename(MODEL);
  };

  const record = async () => {
    const perm = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
    if (perm !== PermissionsAndroid.RESULTS.GRANTED) { setErr("Microphone permission is off."); return; }
    chunks.current = []; bytes.current = 0;
    LiveAudioStream.init({ sampleRate: RATE, channels: 1, bitsPerSample: 16, audioSource: 6, bufferSize: 4096, wavFile: "" });
    if (!wired) { LiveAudioStream.on("data", (b64) => sink?.(b64)); wired = true; }
    sink = (b64: string) => {
      const bin = atob(b64), u = new Uint8Array(bin.length);
      let sq = 0;
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      const pcm = new Int16Array(u.buffer, 0, u.length >> 1);
      for (let i = 0; i < pcm.length; i++) sq += pcm[i] * pcm[i];
      setLevel(Math.min(1, Math.sqrt(sq / (pcm.length || 1)) / 6000));
      chunks.current.push(u); bytes.current += u.length;
      if (bytes.current >= MAX_S * RATE * 2) confirm();
    };
    LiveAudioStream.start();
    live.current = true; setOn(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    context().catch(() => {});                          // load the model while they talk
  };

  const start = async () => {
    setErr(null);
    for (const f of OLD) { const old = new File(dir(), f); if (old.exists) old.delete(); }
    if (modelFile().exists) return record();
    Alert.alert("Voice model", `Voice typing runs on this phone and needs a one-time ${MODEL_MB} MB download. Use Wi-Fi if you can.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Download", onPress: async () => {
        try { await download(); setBusy(null); record(); }
        catch (e) { setBusy(null); setErr(`Download failed: ${e instanceof Error ? e.message : e}`); try { partFile().delete(); } catch {} }
      } },
    ]);
  };

  const halt = async () => {
    sink = null; live.current = false;
    try { await LiveAudioStream.stop(); } finally { setOn(false); setLevel(0); releaseLater(); }
  };

  async function confirm() {
    if (!live.current) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await halt();
    if (bytes.current < RATE * 2 * 0.3) return;         // under 0.3 s: a mis-tap, not speech
    const pcm = new Uint8Array(bytes.current);
    let o = 0;
    for (const c of chunks.current) { pcm.set(c, o); o += c.length; }
    chunks.current = []; bytes.current = 0;
    setBusy("Transcribing…");
    transcribing = true;
    try {
      const { promise } = (await context()).transcribeData(pcm.buffer, { maxThreads: 6 });
      const said = (await promise).result.replace(/\[[^\]]*\]|\([^)]*\)/g, "").trim();   // drop [BLANK_AUDIO], (music)
      if (said) setText([text.trim(), said].filter(Boolean).join(" "));
    } catch (e) {
      setErr(`Couldn't transcribe: ${e instanceof Error ? e.message : e}`);
    } finally {
      transcribing = false; setBusy(null); releaseLater();
    }
  }

  const drop = async () => { await halt(); chunks.current = []; bytes.current = 0; };
  const cancel = () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); return drop(); };

  // Leaving mid-take must not leave the mic open: another tab, the app backgrounded, or unmount.
  const leave = useEffectEvent(() => { if (live.current) drop().catch(() => {}); });
  const focused = useIsFocused();
  useEffect(() => { if (!focused) leave(); }, [focused]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => { if (s === "background") { leave(); release(); } });
    return () => { sub.remove(); leave(); };
  }, []);

  return { on, busy, level, err, start, confirm, cancel };
}
