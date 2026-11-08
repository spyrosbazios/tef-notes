// Something shared from another app, or pasted here: a link, text, photos or a PDF. The installed app is Android's share target
// (the manifest's `share_target`; the service worker, sw/sw.ts, stashes the post and redirects here with `?shared=1`), and
// a browser with no share target gets the box. A link, text or one photo gets what the extension and the phone offer
// (core/clip.ts): the server suggests the notes and open tasks it fits, the owner adds a note of their own if they like, and one
// click files it into a note, a task, a new note or a new task (services/clip.ts). PDFs and several photos, which the clip
// routes don't take, go in a new note of their own; the assistant can file any of it instead. Nothing is written until
// something is clicked.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, ChevronLeft, ClipboardPaste, FilePlus2, FileText, Link2, ListPlus, ListTodo, Loader2, SquarePlus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Turns } from "@/components/swap";
import { Textarea } from "@/components/ui/textarea";
import { choices, sendsFile, summaryNotice, type ClipResult, type Suggestions, type Target } from "@/core/clip";
import { noteIdOf } from "@/core/notes";
import { askText, clipOf, clipTags, fromPasted, fromPost, type Shared } from "@/core/share";
import { useAssistant } from "@/hooks/assistant";
import { useActiveLens } from "@/hooks/lens";
import { ALL_PHOTOS } from "@/hooks/photos";
import { previewQuery } from "@/hooks/previews";
import { clipSummary, saveShared, takeShared } from "@/hooks/share";
import { downscale, look } from "@/lib/picture";
import { INSETS } from "@/hooks/shell";
import { cn } from "@/lib/utils";
import { syncNow } from "@/lib/sync";
import { message } from "@/services/api";
import * as clips from "@/services/clip";

const RERANK_MS = 900;   // a pause in typing the note before asking again

/** What a choice is called in a list: a note's path, a task's id, else its kind. */
const targetKey = (t: Target) => (t.kind === "note" ? t.path : t.kind === "task" ? t.id : t.kind);
const targetIcon = (t: Target) => (t.kind === "task" ? ListTodo : t.kind === "note" ? ListPlus : t.kind === "newtask" ? SquarePlus : FilePlus2);

type Ask = { state: "idle" | "loading" | "failed"; s?: undefined } | { state: "ready"; s: Suggestions };
type Held = { shared: Shared | null; files: File[] };

const ROW = "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50";

/** The box a browser with no share target uses, and what a share that held nothing falls back to. */
function Paste({ onShare }: { onShare: (s: Shared) => void }) {
  const [text, setText] = useState("");
  const shared = fromPasted(text);
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (shared) onShare(shared); }}>
      <p className="text-sm text-dim">Paste a link or some text to file it. On Android, installed from Chrome, TEF Notes is in the Share sheet of other apps.</p>
      <Textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="A link or some text" aria-label="A link or some text" className="min-h-28" />
      <Button type="submit" disabled={!shared}><ClipboardPaste /> Continue</Button>
    </form>
  );
}

/** The share as it came: the link (with the page's own title), the text, photos as thumbnails, PDFs by name. */
function Shown({ shared, files, title, image }: { shared: Shared; files: File[]; title: string | null; image?: string }) {
  // Their addresses live as long as the page, which is short-lived and holds the files itself
  const urls = useMemo(() => shared.images.map((i) => URL.createObjectURL(files[Number(i.uri)])), [shared, files]);
  return (
    <section className="space-y-3 rounded-xl border border-line bg-card p-4" aria-label="Shared">
      {shared.url && (
        <div className="flex items-start gap-3">
          {image ? <img src={image} alt="" className="size-14 shrink-0 rounded-md object-cover" /> : <Link2 className="mt-0.5 size-[18px] shrink-0 text-dim" />}
          <div className="min-w-0 space-y-0.5">
            {title ? <p className="font-semibold">{title}</p> : null}
            <p className="line-clamp-2 break-all text-[13px] text-dim">{shared.url}</p>
          </div>
        </div>
      )}
      {shared.text ? <p className="line-clamp-[12] whitespace-pre-wrap text-[15px] leading-relaxed">{shared.text}</p> : null}
      {urls.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {urls.map((u) => <img key={u} src={u} alt="A shared photo" className="size-20 rounded-md object-cover" />)}
        </div>
      )}
      {shared.pdfs.map((p) => <p key={p.uri} className="flex items-center gap-3 text-sm text-dim"><FileText className="size-[18px] shrink-0" /><span className="truncate">{p.name}</span></p>)}
    </section>
  );
}

export function SharePage() {
  const qc = useQueryClient(), assistant = useAssistant(), lens = useActiveLens();
  const navigate = useNavigate(), { shared: arrived } = useSearch({ from: "/share" });
  // `?shared=err`: the worker could not read what was shared; the box is shown with a line saying so
  const [failed, setFailed] = useState(arrived === "err");
  const [held, setHeld] = useState<Held | null | "loading">(arrived && !failed ? "loading" : null);
  const [{ on: summary }, setSummary] = clipSummary.use();
  const [busy, setBusy] = useState<"note" | "agent" | "clip" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [done, setDone] = useState<{ r: ClipResult; notice: string } | null>(null);   // saved, but not as asked: what to tell before opening it
  const [ask, setAsk] = useState<Ask>({ state: "idle" });
  const asking = useRef<AbortController | null>(null), ranked = useRef(""), pause = useRef<ReturnType<typeof setTimeout>>(undefined), seen = useRef<Promise<string> | null>(null);

  // What the service worker stashed, taken once; the address loses `?shared=1` so a reload doesn't look for it again
  useEffect(() => {
    if (held !== "loading") return;
    let live = true;
    void takeShared().then((p) => {
      if (!live) return;
      setHeld(p ? { shared: fromPost(p), files: p.files } : null);
      void navigate({ to: "/share", search: {}, replace: true });
    });
    return () => { live = false; };
  }, [held, navigate]);

  // A share that could not be read may have left a stash half-written: emptied, and the address loses `?shared=err`
  useEffect(() => {
    if (!failed) return;
    void takeShared().then(() => navigate({ to: "/share", search: {}, replace: true }));
  }, [failed, navigate]);

  const shared = held && held !== "loading" ? held.shared : null, files = held && held !== "loading" ? held.files : [];
  const url = shared?.url ?? null;
  const preview = useQuery({ ...previewQuery(url ?? ""), enabled: !!url, retry: 1 });
  const title = preview.data?.title || null;
  const titled = !url || !preview.isPending;                  // the page's title fetched, or failed, or none to fetch
  const clip = useMemo(() => (shared ? clipOf(shared, title) : null), [shared, title]);
  const picture = shared?.images.length === 1 ? files[Number(shared.images[0].uri)] : undefined;

  /** Where it fits, with the note as it is now; an answer overtaken by a newer question is dropped. */
  const rank = useCallback(async (words: string) => {
    if (!clip) return;
    asking.current?.abort();
    const ctl = new AbortController();
    asking.current = ctl;
    ranked.current = words;
    setAsk((a) => (a.state === "ready" ? a : { state: "loading" }));
    try {
      seen.current ??= picture ? look(picture) : null;
      const s = await clips.suggest(clip, words, picture ? await seen.current! : undefined, ctl.signal);
      if (!ctl.signal.aborted) setAsk({ state: "ready", s });
    } catch {
      if (!ctl.signal.aborted) setAsk((a) => (a.state === "ready" ? a : { state: "failed" }));   // the choices from before the note stay
    }
  }, [clip, picture]);
  useEffect(() => {
    if (clip && titled) void rank(ranked.current);
  }, [clip, titled, rank]);
  useEffect(() => () => { clearTimeout(pause.current); asking.current?.abort(); }, []);

  const rerank = () => {
    clearTimeout(pause.current);
    if (clip && busy == null && note.trim() !== ranked.current) void rank(note.trim());
  };

  /** What the save touched, current in the lists before it is opened (the opened page would say "gone" for a note it hasn't
   *  fetched yet), and the page opened in place of this one: Back from it is Home, not an empty share. */
  const open = async (r: ClipResult) => {
    await Promise.all([syncNow(), qc.invalidateQueries({ queryKey: ALL_PHOTOS })]);
    await navigate(r.kind === "task" ? { to: "/inbox", search: { t: r.id }, replace: true } : { to: "/", search: { note: noteIdOf(r.path) }, replace: true });
  };

  /** File it where the owner chose; the server answering with a refusal is shown, and nothing is written. */
  const file = async (target: Target) => {
    if (!clip) return;
    clearTimeout(pause.current);
    setBusy("clip"); setErr(null);
    try {
      const r = await clips.save(clip, ask.s?.line, target, note.trim(), summary, clipTags(target, lens), picture && sendsFile(clip, target) ? await downscale(picture) : undefined);
      const notice = summaryNotice(r);
      if (notice) { setDone({ r, notice }); setBusy(null); } else await open(r);
    } catch (e) {
      setErr(`Couldn't save it: ${message(e)}`);
      setBusy(null);
    }
  };

  /** A note of its own, for what the clip routes don't take. */
  const asNote = async () => {
    if (!shared) return;
    setBusy("note"); setErr(null);
    try {
      const path = await saveShared(qc, shared, files, title, note);
      await navigate({ to: "/", search: { note: noteIdOf(path) }, replace: true });
    } catch (e) {
      setErr(`Couldn't save it: ${message(e)}`);
      setBusy(null);
    }
  };

  /** Hand it to the assistant: files go in a note first (it can't attach them), then a message with the share, sent as the phone
   *  sends it. If the chat isn't ready to send, the message is a draft in the field. */
  const asAgent = async () => {
    if (!shared) return;
    setBusy("agent"); setErr(null);
    try {
      const filesAt = shared.images.length || shared.pdfs.length ? await saveShared(qc, shared, files, title, "", true) : undefined;
      const text = askText(shared, title, filesAt);
      await navigate({ to: "/", replace: true });
      if (await assistant.send(text)) assistant.show(); else assistant.show(text);
    } catch (e) {
      setErr(`Couldn't hand it over: ${message(e)}`);
      setBusy(null);
    }
  };

  const fresh = (s: Shared) => { setFailed(false); setHeld({ shared: s, files: [] }); };
  const rows = clip && ask.state === "ready" ? choices(ask.s, !!clip.image) : clip ? choices({ suggestions: [], pick: { kind: "new" } }, !!clip.image) : [];

  return (
    <div className={cn("h-dvh", INSETS)}><div className="h-full overflow-y-auto bg-bg">
      <div className="mx-auto max-w-xl space-y-4 px-4 pb-10">
        <header className="sticky top-0 z-10 -mx-4 flex h-12 items-center gap-1 border-b border-line bg-bg px-2">
          <Button variant="ghost" size="sm" aria-label="Back" onClick={() => navigate({ to: "/", replace: true })}><ChevronLeft /> Back</Button>
          <h1 className="font-semibold">Shared with TEF Notes</h1>
        </header>

        {held === "loading" ? <p className="text-sm text-dim">Reading what was shared…</p> : !shared ? (
          <>
            {failed ? <p className="text-sm text-warn" role="alert">Couldn&apos;t read what was shared</p> : null}
            <Paste onShare={fresh} />
          </>
        ) : (
          <>
            <Shown shared={shared} files={files} title={title} image={preview.data?.image || undefined} />
            {clip && !done && (
              <>
                <Textarea placeholder="Add a note (optional)" value={note} disabled={!!busy} aria-label="A note to save with it" className="min-h-20"
                  onChange={(e) => { setNote(e.target.value); clearTimeout(pause.current); pause.current = setTimeout(rerank, RERANK_MS); }} onBlur={rerank} />
                <div className="flex items-center gap-3 px-1">
                  <Switch id="clip-summary" checked={summary} onCheckedChange={(on) => setSummary({ on })} disabled={!!busy} />
                  <Label htmlFor="clip-summary" className="text-[15px] font-normal">Add a summary</Label>
                </div>
                {ask.state === "loading" && <p className="flex items-center gap-3 px-2 text-sm text-dim"><Loader2 className="size-4 animate-spin" /> Finding where it fits…</p>}
                {ask.state === "failed" && <p className="px-2 text-sm text-dim">Couldn&apos;t ask the server where it fits. You can still save it as a new note or task.</p>}
                <section aria-label="Where should it go?" className="space-y-1">
                  <h2 className="px-2 text-xs font-semibold uppercase tracking-wide text-faint">Where should it go?</h2>
                  <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-card">
                    {rows.map((c) => {
                      const Icon = targetIcon(c.target);
                      return (
                        <li key={targetKey(c.target)}>
                          <button type="button" className={ROW} disabled={!!busy} onClick={() => void file(c.target)}>
                            <Icon className="size-[18px] shrink-0 text-dim" />
                            <span className="min-w-0 flex-1 truncate">{c.label}</span>
                            {c.hint ? <span className="text-[13px] text-dim">{c.hint}</span> : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              </>
            )}
            {!clip && (
              <>
                <Textarea placeholder="Add a note (optional)" value={note} disabled={!!busy} aria-label="A note to save with it" className="min-h-20" onChange={(e) => setNote(e.target.value)} />
                <p className="px-2 text-sm text-dim">PDFs and several photos go in a note of their own.</p>
                <Button size="lg" className="w-full" disabled={!!busy} onClick={() => void asNote()}>
                  <Turns aria-live="polite" state={busy === "note" ? "busy" : "idle"}
                    states={{ idle: <><FilePlus2 /> Save as a new note</>, busy: <><Loader2 className="animate-spin" /> Saving…</> }} />
                </Button>
              </>
            )}
            {done && (
              <div className="space-y-3 rounded-xl border border-line bg-card p-4">
                <p className="text-sm text-warn">{done.notice}</p>
                <Button onClick={() => void open(done.r)}>{done.r.kind === "task" ? "Open the task" : "Open the note"}</Button>
              </div>
            )}
            {err ? <p className="text-sm text-warn" role="alert">{err}</p> : null}
            {!done && (
              <Button size="lg" variant="secondary" className="w-full" disabled={!!busy} onClick={() => void asAgent()}>
                <Turns aria-live="polite" state={busy === "agent" ? "busy" : "idle"}
                  states={{ idle: <><Bot /> Ask the assistant to file it</>, busy: <><Loader2 className="animate-spin" /> Handing it over…</> }} />
              </Button>
            )}
          </>
        )}
      </div>
    </div></div>
  );
}

