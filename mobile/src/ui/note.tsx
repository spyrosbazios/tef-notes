// A note as a screen, edited as it reads, as on the web: the title is a field and the body is the web app's editor
// (ui/editor.tsx, in a WebView: boxes tick in place, photos, link cards and YouTube players show), always. The keyboard
// comes up only for a tap in the text (or the title of a note just made); while it is up, the format tools sit on it and Done
// puts it away. The editor hands back markdown and that is what is saved, so editing an old note may tidy its markup (`*`
// bullets become `-`); the file still round-trips through the server and the laptop CLI. The frontmatter never reaches the
// editor: a save puts the new body under it unchanged (a retitle rewrites it with serializeNote), so flags survive an edit.
import { router, useFocusEffect, type Href } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Linking, ScrollView, TextInput, View } from "react-native";
import { KeyboardAvoidingView, KeyboardController, useKeyboardState } from "react-native-keyboard-controller";
import type { MarkdownStyle } from "react-native-enriched-markdown";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { EditorCommand } from "@/core/editor-bridge";
import { noteLinkPath, youtubeVideo } from "@/core/links";
import { mergeDraft, noteIdOf, parseNote, UNTITLED, withBody } from "@/core/notes";
import { attachmentLink, drawingPreview, isDrawing, isPdf } from "@/core/photos";
import { useAttachmentsFor } from "@/store/attachments";
import { movedTo, noteText, syncNotes, useNotes, useNoteText } from "@/store/notes";
import { NoteMenu } from "./actions";
import { AttachSheet } from "./attach";
import { ConflictBanner } from "./conflicts";
import { EditorWebView, type EditorHandle } from "./editor";
import { Button, T } from "./ds";
import { LinkedTasks } from "./links";
import { FormatBar, NoteBar } from "./note-bar";
import { NoteMeta } from "./note-tags";
import type { Palette } from "@/core/theme";
import { useTheme } from "./use-theme";
import { openVideo } from "./video";

const MONO = "AtkinsonHyperlegibleMono_400Regular";
const mdStyle = (C: Palette): MarkdownStyle => {
  const block = { fontFamily: "AtkinsonHyperlegibleNext_400Regular", color: C.fg, fontSize: 15, lineHeight: 22, marginBottom: 10 };
  const head = (fontSize: number) => ({ ...block, fontFamily: "AtkinsonHyperlegibleNext_700Bold", fontSize, lineHeight: fontSize * 1.3, marginTop: 6 });
  return {
    paragraph: block,
    h1: head(22), h2: head(18), h3: head(16),
    list: { ...block, bulletColor: C.brand, markerColor: C.dim, marginBottom: 6 },
    blockquote: { ...block, color: C.dim, borderColor: C.line, backgroundColor: C.card },
    link: { color: C.brand, underline: false },
    strong: { fontFamily: "AtkinsonHyperlegibleNext_600SemiBold" },
    code: { fontFamily: MONO, fontSize: 13, color: C.fg, backgroundColor: C.raised, borderColor: C.line },
    codeBlock: { fontFamily: MONO, fontSize: 13, color: C.fg, backgroundColor: C.card, borderColor: C.line, borderRadius: 12, padding: 12 },
    thematicBreak: { color: C.line },
    taskList: { checkedColor: C.brand, borderColor: C.dim, checkmarkColor: C.bg, checkedTextColor: C.dim },
    table: { borderColor: C.line, headerBackgroundColor: C.raised, color: C.fg, fontSize: 13 },
    image: { borderRadius: 12, marginBottom: 10 },
  };
};

/** The markdown style of what the phone draws natively (Ask answers, confirm cards, a task's notes, Reader view), inked in the active theme. */
export function useMarkdownStyle(): MarkdownStyle {
  const { C } = useTheme();
  return useMemo(() => mdStyle(C), [C]);
}

/** `$50` is money, not math; a line break typed on the phone is a line break. */
export const FLAGS = { latexMath: false, hardSoftBreaks: true };

/** "New note": made at once as Untitled and opened in the editor with the title field focused; one left as it was made is dropped (`discardNew`). */
export const newNote = () => openNote(useNotes.getState().create(UNTITLED), true);

/** Its route: the id is the filename, which never changes, so links to a note survive a retitle. `fresh`: just made. */
export function openNote(path: string, fresh = false) {
  const id = useNotes.getState().notes[path]?.id ?? noteIdOf(path);
  router.push({ pathname: "/note/[id]", params: { id, ...(fresh ? { fresh: "1" } : {}) } });
}

/** A PDF attached to a note, in the viewer (ui/pdf.tsx). `href`: `../attachments/<note-id>/<name>.pdf`, or the copy
 *  on this phone a page shows it as. False when `href` is no PDF of a note's. */
export function openPdf(href: string): boolean {
  const a = attachmentLink(href);
  if (!a || !isPdf(a.name)) return false;
  router.push({ pathname: "/pdf", params: { note: a.noteId, name: a.name } });
  return true;
}

/** A note's pictures full screen (ui/photos.tsx): `srcs` are `../attachments/<note-id>/<name>` paths, or the file:// copies
 *  a page shows them as, or an address elsewhere; `index` is the one tapped. */
export function openPhotos(srcs: string[], index: number) {
  router.push({ pathname: "/photos", params: { srcs: JSON.stringify(srcs), index: String(index) } });
}

/** A drawing attached to a note (the phone only looks at it: the web app edits it), in the picture viewer, as its PNG
 *  preview. `href`: the link to the `.excalidraw`. False when `href` is no drawing of a note's. */
export function openDrawing(href: string): boolean {
  const a = attachmentLink(href);
  if (!a || !isDrawing(a.name)) return false;
  openPhotos([drawingPreview(href)], 0);
  return true;
}

/** A link tapped in a note, a tile, a card or an answer: a PDF attached to a note opens in the viewer, a drawing in the
 *  picture viewer, one to another
 *  note, as the laptop writes them (`20261001-foo.md`, `notes/foo.md`), opens it here; anything else goes to the OS,
 *  quietly if nothing takes it. */
export function openLink(url: string) {
  if (openPdf(url) || openDrawing(url)) return;
  if (youtubeVideo(url)) { openVideo(url); return; }
  const p = noteLinkPath(url);
  if (p) openNote(p);
  else Linking.openURL(url).catch(() => {});
}

/** A linked page read as an article (ui/reader.tsx), from a link's "Reader view" button. */
export function openReader(url: string) {
  router.push({ pathname: "/reader", params: { url } });
}

/** Back where the user came from; a screen opened cold by a link has nothing under it, so `home`. */
export const goBack = (home: Href = "/home") => (router.canGoBack() ? router.back() : router.replace(home));

/** The addresses of the images a body shows, in order: what a tap on one pages through. */
export const bodyImages = (md: string) => [...md.matchAll(/!\[[^\]]*\]\(\s*<?([^)\s>]+)/g)].map((m) => m[1]);

export function NoteScreen({ path, fresh = false }: { path: string; fresh?: boolean }) {
  const { C } = useTheme();
  const insets = useSafeAreaInsets();
  const raw = useNoteText(path), missing = raw == null;       // null: indexed, but its text isn't on this phone yet
  const text = raw ?? "";
  const note = useMemo(() => parseNote(path, text), [path, text]);
  const meta = useNotes((s) => s.notes[path]);
  const sync = useNotes((s) => s.sync);
  const { write, discardNew } = useNotes.getState();
  const keyboard = useKeyboardState((s) => s.isVisible);
  const [body, setBody] = useState<string | null>(null);     // the editor's text while a save is pending; null = the stored body
  const [title, setTitle] = useState<string | null>(null);   // the title field while it has the keyboard; null = the stored title
  const [titling, setTitling] = useState(fresh);             // the title field has the keyboard: no format tools for it
  const [clash, setClash] = useState(false);                 // a save kept the draft over edits made elsewhere to the same lines
  const [menu, setMenu] = useState(false);
  const [attaching, setAttaching] = useState(false);          // the attach sheet is up
  const [attachBusy, setAttachBusy] = useState(false);        // a pick or a save is under way
  const editor = useRef<EditorHandle>(null);
  const [active, setActive] = useState<EditorCommand[]>([]);   // the format tools on at the cursor
  const [attachErr, setAttachErr] = useState<string | null>(null);
  const landed = useAttachmentsFor(note.id, note.body);      // photos not on this phone yet, each drawn as it lands

  // Typing saves 400 ms after the last key, not per key: each write is a SQLite row, an FTS reindex and an
  // index re-sort. A save reads the file afresh, so a flag set mid-edit isn't written back over; and when the body
  // moved on under the draft (a pull, a merge on push, the agent) the draft is merged into it from `start`, the body
  // it began from, not written over it. Saved, the editor shows the stored body again.
  const latest = useRef({ text, note });
  useEffect(() => { latest.current = { text, note }; });
  const pending = useRef<{ title?: string; body?: string }>({});
  const start = useRef<string | null>(null);
  const made = useRef(fresh ? raw : null);                  // a note just made, as it was made
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const p = pending.current, t = p.title?.trim();
    if (p.title == null && p.body == null) return;
    pending.current = {};
    const at = movedTo(path), was = noteText(at) ?? latest.current.text, n = parseNote(at, was);
    let b = p.body ?? n.body;
    if (p.body != null && start.current != null && n.body !== start.current) {
      const m = mergeDraft(start.current, p.body, n.body);
      b = m.text;
      if (m.clash) setClash(true);
    }
    start.current = null;
    if (p.body != null) setBody(null);
    write(at, withBody(was, n, b, t));
  }, [path, write]);
  const later = (p: { title?: string; body?: string }) => {
    pending.current = { ...pending.current, ...p };
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 400);
  };
  const typed = (t: string) => {
    if (start.current == null) start.current = body ?? note.body;     // what the editor showed as they began
    setBody(t); later({ body: t });
  };
  // The file changed under a pending draft: merge it in now, not at the next pause
  useEffect(() => useNotes.subscribe((s, was) => { if (s.rev[path] !== was.rev[path]) flush(); }), [path, flush]);
  // Backgrounding mustn't lose the last 400 ms of typing: the draft goes into SQLite before the OS may freeze the app
  useEffect(() => {
    const sub = AppState.addEventListener("change", (st) => { if (st !== "active") flush(); });
    return () => sub.remove();
  }, [flush]);
  // Leaving the note sends it; one just made and left as it was never happened
  useFocusEffect(useCallback(() => () => {
    flush();
    if (made.current != null) discardNew(path, made.current);
    syncNotes();
  }, [flush, path, discardNew]));
  // Done: what was typed is saved now and the keyboard goes; the note stays as it is, there is no mode to leave
  const done = () => { flush(); KeyboardController.dismiss(); };

  const status = meta?.conflict ? "conflict" : sync.state === "off" ? "on this phone only"
    : !meta?.dirty ? (!meta ? "" : sync.state === "error" ? "sync failed" : "synced")
    : sync.state === "syncing" ? "sending…" : sync.state === "error" ? "not sent — sync failed" : "unsent";

  // Photos and PDFs go into the editor at the cursor, a line each (at the end while the text was never tapped); the picker,
  // downscale and upload queue are the store's
  const attached = (md: string) => editor.current?.insert(`${md.split("\n").join("\n\n")}\n`);

  // An Untitled note shows an empty field over the word, ready to be typed over
  const stored = note.title === UNTITLED ? "" : note.title;
  const info = [note.created, status === "synced" ? "" : status].filter(Boolean).join(" · ");   // "synced" is the usual state: only a state that needs a look is said
  return (
    <KeyboardAvoidingView behavior="padding" className="flex-1 bg-bg">
      <NoteBar top={insets.top} typing={keyboard} missing={missing} attaching={attachBusy} onBack={() => goBack()}
        onDone={done} onMenu={() => { flush(); setMenu(true); }}>
        {missing ? <T variant="title" numberOfLines={2} className="leading-[26px]">{note.title}</T> : (
          <TextInput value={title ?? stored} onChangeText={(t) => { setTitle(t); later({ title: t }); }} placeholder={UNTITLED} placeholderTextColor={C.faint}
            onFocus={() => setTitling(true)} onBlur={() => { flush(); setTitle(null); setTitling(false); }}
            accessibilityLabel="Title" autoFocus={fresh} autoCapitalize="sentences" multiline returnKeyType="next" submitBehavior="blurAndSubmit"
            selectionColor={C.brand} cursorColor={C.brand} className="p-0 font-heavy text-fg" style={{ fontSize: 20, lineHeight: 26, letterSpacing: -0.2 }} />
        )}
      </NoteBar>
      <NoteMeta path={path} tags={note.tags} missing={missing} info={info} warn={!!meta?.conflict || (!!meta?.dirty && sync.state === "error")} />
      <ConflictBanner path={path} className="mx-4 mb-2 mt-1 w-auto" />
      {attachErr ? <T tone="warn" size={12} className="px-5 pb-2">{attachErr}</T> : null}
      {clash ? <T tone="warn" size={12} className="px-5 pb-2">Edited elsewhere on the same lines as you typed: your version was kept.</T> : null}

      {missing ? (
        <View className="items-start gap-3 px-5 py-4">
          <T tone="dim" size={14}>{meta ? "Not on this phone yet. It downloads on the next sync." : "This note isn't on this phone."}</T>
          {meta && sync.state !== "off" && (
            <Button size="sm" variant="tonal" loading={sync.state === "syncing"} disabled={sync.state === "syncing"}
              onPress={() => syncNotes()}>Sync now</Button>
          )}
        </View>
      ) : (
        <>
          {/* Its tasks under the title, as on the web; out of the way while typing, when the text needs the room */}
          {keyboard ? null : <ScrollView style={{ maxHeight: 176, flexGrow: 0 }} contentContainerClassName="px-4"><LinkedTasks path={path} className="mb-1" /></ScrollView>}
          <View className="flex-1">
            <EditorWebView ref={editor} noteId={note.id} markdown={body ?? note.body} landed={landed} onChange={typed} onState={setActive}
              onFile={(href) => { openPdf(href); }} onImage={openPhotos} onLink={openLink} onRead={openReader} />
          </View>
          {keyboard && !titling ? <FormatBar active={active} onCommand={(name, arg) => editor.current?.command(name, arg)} /> : null}
          {keyboard ? null : <View style={{ height: insets.bottom }} />}
        </>
      )}

      <NoteMenu path={menu ? path : null} onClose={() => setMenu(false)} onDeleted={() => goBack()} onAttach={() => setAttaching(true)} />
      <AttachSheet noteId={note.id} open={attaching} onOpenChange={setAttaching} onAttached={attached} onError={setAttachErr} onBusy={setAttachBusy} />
    </KeyboardAvoidingView>
  );
}
