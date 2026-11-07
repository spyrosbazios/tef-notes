// Something shared from another app — a link, text, photos, PDFs — lands here, from the layout's intent watcher. A link,
// text or one photo gets what the browser extension offers (core/clip.ts): the server suggests the notes and open tasks
// it fits, the owner adds a note of their own if they like, and one tap files it into a note, a task or a new note
// (src/store/clip.ts). Without a server, or when it can't be asked, a new note on this phone is the way, as it is for
// PDFs and several photos, which the clip routes don't take. The agent can file any of it instead. Nothing is written
// until something is tapped; Back drops it. A link's page title is fetched first, for the suggestions and the title.
// "Add a summary" (remembered, off by default) has the server write one under the link or picture; when it couldn't, the
// share is saved all the same and the screen says so before the owner opens what it went into. A screenshot is shared like
// any other picture.
import { router, useNavigation } from "expo-router";
import { Bot, FilePlus2, FileText, Image as ImageIcon, Link2, ListPlus, ListTodo, SquarePlus } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { replying } from "@/agent/background";
import { choices, type ClipResult, type Suggestions, summaryNotice, type Target } from "@/core/clip";
import { HttpError } from "@/core/http";
import { linkTitle } from "@/core/links";
import { noteIdOf } from "@/core/notes";
import { clipError } from "@/core/pocketbase";
import { clipOf } from "@/core/share";
import { useModel } from "@/store/agent";
import { saveClip, suggestClip } from "@/store/clip";
import { useKeys } from "@/store/keys";
import { usePrefs } from "@/store/prefs";
import { dropShare, saveShared, shareWithAgent, useShare } from "@/store/share";
import { Banner, Button, Card, Checkbox, ListRow, ListSection, ScreenHeader, T, Textarea, Touchable } from "@/ui/ds";
import { goBack } from "@/ui/note";
import { useTheme } from "@/ui/use-theme";

const RERANK_MS = 900;   // a pause in typing the note before asking again

/** What a choice is called in a list: a note's path, a task's id, else its kind. */
const targetKey = (t: Target) => (t.kind === "note" ? t.path : t.kind === "task" ? t.id : t.kind);
const targetIcon = (t: Target) => (t.kind === "task" ? ListTodo : t.kind === "note" ? ListPlus : t.kind === "newtask" ? SquarePlus : FilePlus2);

type Ask = { state: "idle" | "loading" | "failed"; s?: undefined } | { state: "ready"; s: Suggestions };

export default function Share() {
  const insets = useSafeAreaInsets();
  const { C } = useTheme();
  const shared = useShare((s) => s.shared);
  const agent = !!useModel().model;
  const server = useKeys((s) => s.keys.server);
  const url = shared?.url ?? null;
  const [page, setPage] = useState<{ url: string; title: string | null } | null>(null);   // the link's page title, once fetched
  const title = page && page.url === url ? page.title : null;
  const titled = !url || page?.url === url;                                               // fetched, or failed, or none to fetch
  const [busy, setBusy] = useState<"note" | "agent" | "clip" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const summary = usePrefs((s) => s.clipSummary);
  const [done, setDone] = useState<{ r: ClipResult; notice: string } | null>(null);   // saved, but not as asked: what to tell before opening it
  const [ask, setAsk] = useState<Ask>({ state: "idle" });
  const asking = useRef(0), ranked = useRef(""), pause = useRef<ReturnType<typeof setTimeout>>(undefined);
  // The share as a clip, when the server can be asked: not for PDFs or several photos, nor with no server set
  const clip = useMemo(() => (server && shared ? clipOf(shared, title) : null), [server, shared, title]);
  const picture = shared?.images[0];

  useEffect(() => {
    if (!url) return;
    let live = true;
    linkTitle(url).then((t) => { if (live) setPage({ url, title: t }); }, () => { if (live) setPage({ url, title: null }); });
    return () => { live = false; };
  }, [url]);

  // Opened cold by a share the module gave up on, or come back to after one was dealt with: nothing to show, so home.
  // Only while this screen is the one shown: handing the share to the agent drops it on the way to Ask, and this
  // screen, still mounted under it, once sent the owner home from there.
  const navigation = useNavigation();
  useEffect(() => {
    if (shared) return;
    const t = setTimeout(() => { if (!useShare.getState().shared && navigation.isFocused()) goBack(); }, 3000);
    return () => clearTimeout(t);
  }, [shared, navigation]);

  /** Where it fits, with the note as it is now; an answer overtaken by a newer question is dropped. */
  const rank = useCallback(async (words: string) => {
    if (!clip) return;
    const n = ++asking.current;
    ranked.current = words;
    setAsk((a) => (a.state === "ready" ? a : { state: "loading" }));
    try {
      const s = await suggestClip(clip, words, picture);
      if (n === asking.current) setAsk({ state: "ready", s });
    } catch {
      if (n === asking.current) setAsk((a) => (a.state === "ready" ? a : { state: "failed" }));   // the choices from before the note stay
    }
  }, [clip, picture]);
  useEffect(() => {
    if (clip && titled) void rank(ranked.current);
  }, [clip, titled, rank]);
  useEffect(() => () => clearTimeout(pause.current), []);

  const rerank = () => {
    clearTimeout(pause.current);
    if (clip && busy == null && note.trim() !== ranked.current) void rank(note.trim());
  };

  /** The share as a note on this phone, the owner's own words first. */
  const local = async () => {
    if (!shared) return;
    const text = [note.trim(), shared.text].filter(Boolean).join("\n\n");
    const path = await saveShared({ ...shared, text }, title);
    dropShare();
    router.replace({ pathname: "/note/[id]", params: { id: noteIdOf(path) } });
  };

  const act = async (what: "note" | "agent") => {
    if (!shared) return;
    setBusy(what); setErr(null);
    try {
      if (what === "note") {
        await local();
      } else {
        await shareWithAgent(shared, title, !!replying());
        // navigate, not replace: replace stacked a second tabs screen over the first, whose hidden Ask took the message
        router.navigate("/ask");
      }
    } catch (e) {
      setErr(`Couldn't save it: ${e instanceof Error ? e.message : String(e)}`);
      setBusy(null);
    }
  };

  /** Open what the save touched. */
  const open = (r: ClipResult) => {
    dropShare();
    if (r.kind === "task") router.replace({ pathname: "/task/[id]", params: { id: r.id } });
    else router.replace({ pathname: "/note/[id]", params: { id: noteIdOf(r.path) } });
  };

  /** File it where the owner chose. A new note the server couldn't be reached for is made on this phone instead; the
   *  server answering with a refusal is shown, and nothing is written. */
  const file = async (target: Target) => {
    if (!clip) return;
    clearTimeout(pause.current);
    setBusy("clip"); setErr(null);
    try {
      const r = await saveClip(clip, ask.s?.line, target, note.trim(), summary, picture);
      const notice = summaryNotice(r);
      if (notice) { setDone({ r, notice }); setBusy(null); } else open(r);
    } catch (e) {
      if (target.kind === "new" && !(e instanceof HttpError)) {
        try { await local(); return; } catch (e2) { setErr(`Couldn't save it: ${clipError(e2)}`); }
      } else setErr(`Couldn't save it: ${clipError(e)}`);
      setBusy(null);
    }
  };

  const n = shared?.images.length ?? 0;
  return (
    <View className="flex-1 bg-bg">
      <ScreenHeader title="Shared with TEF Notes" compact back={() => { dropShare(); goBack(); }} />

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
        {!shared ? <T tone="dim" size={14}>Reading what was shared…</T> : (
          <Card title="Shared">
          <View className="gap-3">
            {shared.url && (
              <View className="flex-row items-start gap-3">
                <Link2 size={18} color={C.dim} style={{ marginTop: 2 }} />
                <View className="flex-1 gap-0.5">
                  {title ? <T font="semi" size={15}>{title}</T> : null}
                  <T tone="dim" size={13} numberOfLines={2}>{shared.url}</T>
                </View>
              </View>
            )}
            {shared.text ? <T size={15} className="leading-[22px]" numberOfLines={12}>{shared.text}</T> : null}
            {n > 0 && (
              <View className="flex-row items-center gap-3">
                <ImageIcon size={18} color={C.dim} />
                <T tone="dim" size={14}>{n === 1 ? "1 photo" : `${n} photos`}</T>
              </View>
            )}
            {shared.pdfs.map((p) => (
              <View key={p.uri} className="flex-row items-center gap-3">
                <FileText size={18} color={C.dim} />
                <T tone="dim" size={14} numberOfLines={1} className="flex-1">{p.name}</T>
              </View>
            ))}
          </View>
          </Card>
        )}
        {clip && !done && (
          <>
            <Textarea placeholder="Add a note (optional)" value={note} editable={!busy} onChangeText={(t) => { setNote(t); clearTimeout(pause.current); pause.current = setTimeout(rerank, RERANK_MS); }}
              onBlur={rerank} accessibilityLabel="A note to save with it" />
            <Touchable accessible={false} disabled={!!busy}
              onPress={() => usePrefs.getState().set({ clipSummary: !summary })} className="flex-row items-center gap-3 px-1">
              <Checkbox checked={summary} onCheckedChange={(on) => usePrefs.getState().set({ clipSummary: on })} disabled={!!busy} accessibilityLabel="Add a summary" />
              <T size={15}>Add a summary</T>
            </Touchable>
            {ask.state === "loading" && (
              <View className="flex-row items-center gap-3 px-2 py-1">
                <ActivityIndicator size="small" color={C.dim} />
                <T tone="dim" size={14}>Finding where it fits…</T>
              </View>
            )}
            {ask.state === "failed" && <Banner title="Couldn't ask the server where it fits" description="You can still save it as a new note on this phone." />}
            {ask.state === "ready" && (
              <ListSection title="Where should it go?">
                {choices(ask.s, !!clip.image).map((c) => (
                  <ListRow key={targetKey(c.target)} disabled={!!busy}
                    icon={targetIcon(c.target)}
                    title={c.label} trailing={c.hint ? <T tone="dim" size={13}>{c.hint}</T> : undefined}
                    onPress={() => void file(c.target)} />
                ))}
              </ListSection>
            )}
          </>
        )}
        {done && (
          <Banner variant="warning" title={done.notice}>
            <Button onPress={() => open(done.r)}>{done.r.kind === "task" ? "Open the task" : "Open the note"}</Button>
          </Banner>
        )}
        {err ? <T tone="warn" size={12}>{err}</T> : null}
      </ScrollView>

      {!done && <View className="gap-2 px-4 pt-3" style={{ paddingBottom: insets.bottom + 12 }}>
        {(!clip || ask.state !== "ready" || !!err) && (
          <Button size="lg" icon={FilePlus2} disabled={!shared || !!busy} loading={busy === "note"} onPress={() => act("note")}>
            {clip ? "Save a new note on this phone" : "Save as a new note"}
          </Button>
        )}
        <Button size="lg" variant="tonal" icon={Bot} disabled={!shared || !!busy || !agent} loading={busy === "agent"} onPress={() => act("agent")}>Let the agent file it</Button>
        {!agent && <T tone="faint" size={12} className="px-2 text-center">The agent isn&apos;t reachable: it runs on the notes server, which needs a model provider&apos;s key.</T>}
      </View>}
    </View>
  );
}
