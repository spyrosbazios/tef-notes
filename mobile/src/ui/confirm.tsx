// A note write the agent proposes, shown as what it does before it's done: a new note rendered, the lines an
// append adds, a rewrite as a line diff, a flag change in one line. The user decides. Changes carry a sign or a
// word as well as a colour (never colour alone).
import type { ChatAddToolApproveResponseFunction } from "ai";
import * as Haptics from "expo-haptics";
import { Check, Minus, PenLine } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { EnrichedMarkdownText } from "react-native-enriched-markdown";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import { DECLINED, diffLines, flagLine, rowsOf, tagLine, todoLines, todoWords, type Line, type WriteInput } from "@/core/agent";
import { appended, MEMORY, parseNote } from "@/core/notes";
import { useNotes, useNoteText } from "@/store/notes";
import { Button, T } from "./ds";
import { FLAGS, openLink, useMarkdownStyle } from "./note";
import { useTheme } from "./use-theme";

const CONTEXT = 2;                          // unchanged lines kept around each change; the rest fold to a count
const STRIKE = { textDecorationLine: "line-through" } as const;

function DiffLine({ l }: { l: Line }) {
  const tone = l.op === "+" ? "up" : l.op === "-" ? "down" : "dim";
  return (
    <T tone={tone} size={13} style={l.op === "-" ? STRIKE : undefined}>
      {l.op === "+" ? "+ " : l.op === "-" ? "− " : "  "}{l.text || " "}
    </T>
  );
}

/** Two texts as what changed, line by line: the changes with a little context, the unchanged runs a tap away. */
export function TextDiff({ before, after }: { before: string; after: string }) {
  const lines = useMemo(() => diffLines(before.split("\n"), after.split("\n")), [before, after]);
  const [all, setAll] = useState(false);
  const n = (op: Line["op"]) => lines.filter((l) => l.op === op).length;
  const same = n("=");
  const summary = ([["added", n("+")], ["removed", n("-")], ["unchanged", same]] as const).filter(([, k]) => k).map(([w, k]) => `${k} ${w}`).join(" · ");
  const rows = useMemo(() => rowsOf(lines, CONTEXT, all), [lines, all]);
  return (
    <View className="gap-2">
      <T tone="dim" size={12}>{same === lines.length ? "No changes" : summary}</T>
      <View className="gap-[2px]">
        {rows.map((r, i) => ("l" in r ? <DiffLine key={i} l={r.l} />
          : <T key={i} tone="faint" size={12}>{`  ⋯ ${r.fold} unchanged line${r.fold === 1 ? "" : "s"}`}</T>))}
      </View>
      {all || rows.some((r) => "fold" in r) ? (
        <Pressable onPress={() => { Haptics.selectionAsync(); setAll(!all); }} accessibilityRole="button" className="self-start py-1 active:opacity-70">
          <T tone="brand" font="medium" size={13}>{all ? "Only the changes" : "Show the whole note"}</T>
        </Pressable>
      ) : null}
    </View>
  );
}

/** A preview: its boxes don't tick, there being no note under them yet to save the tick to. */
function Markdown({ md }: { md: string }) {
  const style = useMarkdownStyle();
  return (
    <EnrichedMarkdownText flavor="github" markdown={md} markdownStyle={style} md4cFlags={FLAGS} enableTaskListItemToggle={false}
      onLinkPress={({ url }) => openLink(url)} />
  );
}

/** A rewrite: the body as it is now against the proposed one, and a retitle if there is one. */
function RewriteDiff({ path, title, input }: { path: string; title: string; input: WriteInput }) {
  const text = useNoteText(path) ?? "";
  const body = useMemo(() => parseNote(path, text).body, [path, text]);
  const retitle = input.title?.trim() && input.title.trim() !== title ? input.title.trim() : undefined;
  return (
    <View className="gap-3">
      {retitle ? (
        <View className="gap-[2px]">
          <T tone="dim" font="semi" size={12}>New title</T>
          <T tone="down" size={13} style={STRIKE}>− {title}</T>
          <T tone="up" size={13}>+ {retitle}</T>
        </View>
      ) : null}
      <TextDiff before={body.trimEnd()} after={(input.text ?? "").trimEnd()} />
    </View>
  );
}

/** An append: exactly the lines it adds — a `## ` heading too, when the section is new — as the note will show them. */
function AppendPreview({ path, input }: { path: string; input: WriteInput }) {
  const text = useNoteText(path) ?? "";
  const added = useMemo(() => {
    const body = parseNote(path, text).body, after = appended(body, input.text ?? "", input.section);
    return diffLines(body.split("\n"), after.split("\n")).filter((l) => l.op === "+").map((l) => l.text).join("\n").trim();
  }, [path, text, input.text, input.section]);
  return <Markdown md={added} />;
}

/** A task write: what it does, a line each. */
function TodoPreview({ name, input }: { name: string; input: WriteInput }) {
  const lines = todoLines(name, input);
  return (
    <View className="gap-1">
      {(lines.length ? lines : ["No change"]).map((l, i) => <T key={i} size={14}>{l}</T>)}
    </View>
  );
}

function MemoryDiff({ text }: { text: string }) {
  const before = useNoteText(MEMORY) ?? "";
  return <TextDiff before={before.trimEnd()} after={text.trimEnd()} />;
}

/** What an answered card says: what was done, or what was left undone. */
const VERB: Record<string, [done: string, skipped: string]> = {
  create_tag: ["Created", "create"], update_tag: ["Updated", "update"],
  create_note: ["Created", "create"], append_to_note: ["Added to", "add to"], rewrite_note: ["Rewrote", "rewrite"],
  set_note_flags: ["Changed flags of", "change flags of"], delete_note: ["Deleted", "delete"], update_memory: ["Updated", "update"],
};

/** The agent wants to write one of the user's notes (or, after reading the web, its memory): show it and why; the user decides.
 *  `answer`: once decided the card folds into one line (a tick or a dash). The card and the line are one element, so the
 *  fold animates instead of swapping. The cards of what it wrote are drawn under it (chat/cards.tsx). */
export function Confirm({ name, input, id, respond, answer }: {
  name: string; input: WriteInput; id: string; respond: ChatAddToolApproveResponseFunction; answer?: "yes" | "no";
}) {
  const { C } = useTheme();
  const title = useNotes((s) => (input.path ? s.notes[input.path]?.title : undefined)) ?? input.path ?? "the note";
  const own = todoWords(name, input);
  const head = own?.head ?? {
    create_tag: `Create tag “${input.name ?? ""}”?`, update_tag: `Update tag “${input.name ?? input.id ?? ""}”?`,
    create_note: `Create note “${input.title ?? ""}”?`, append_to_note: `Add to ${title}?`, rewrite_note: `Rewrite ${title}?`,
    set_note_flags: `Change flags of ${title}?`, delete_note: `Delete ${title}?`, update_memory: "Update the agent's memory?",
  }[name] ?? "Go ahead?";
  const yes = own?.yes ?? (name === "create_note" ? "Create it" : name === "append_to_note" ? "Add it" : name === "delete_note" ? "Delete it" : "Save it");
  const flags = name === "create_note" ? flagLine(input) : "";
  const [done, skipped] = own ? [own.done, own.skipped] : VERB[name] ?? ["Allowed", "allow"];
  const subject = own?.subject ?? ((name === "create_tag" || name === "update_tag") ? `tag “${input.name ?? input.id ?? ""}”` : name === "create_note" ? `“${input.title ?? ""}”` : name === "update_memory" ? "memory" : title);
  return (
    <Animated.View layout={LinearTransition}>
      {answer ? (
        <Animated.View entering={FadeIn.delay(120)}>
          <View className="flex-row items-center gap-2">
            {answer === "yes" ? <Check size={14} color={C.up} /> : <Minus size={14} color={C.faint} />}
            <T tone="dim" size={13} numberOfLines={1} className="flex-1">{answer === "yes" ? `${done} ${subject}` : `Didn't ${skipped} ${subject}`}</T>
          </View>
        </Animated.View>
      ) : (
        <Animated.View exiting={FadeOut.duration(150)}>
          <View className="gap-3 rounded-3xl border border-line bg-card p-4">
            <View className="flex-row items-center gap-3">
              <View className="h-9 w-9 items-center justify-center rounded-xl bg-accent">
                <PenLine size={18} color={C.brand} />
              </View>
              <T variant="heading" className="flex-1">{head}</T>
            </View>
            {name === "update_memory" ? <T tone="warn" size={12}>This chat read web pages, or a note written from them, so it asks first.</T> : null}
            {input.why ? <T tone="dim" size={13}>{input.why}</T> : null}
            {flags ? <T tone="dim" size={12}>{flags}</T> : null}
            {name === "append_to_note" && input.section ? <T tone="dim" size={12}>{`Under “${input.section}”`}</T> : null}
            <View className="border-t border-line pt-3">
              {name === "create_note" ? <Markdown md={input.body ?? ""} />
                : name === "append_to_note" && input.path ? <AppendPreview path={input.path} input={input} />
                : name === "rewrite_note" && input.path ? <RewriteDiff path={input.path} title={title} input={input} />
                : (name === "create_tag" || name === "update_tag") ? <T size={14}>{tagLine(name, input)}</T>
                : name === "set_note_flags" ? <T size={14}>{flagLine(input, true) || "No change"}</T>
                : name === "delete_note" ? <T size={14}>Delete it for good, with its photos and PDFs</T>
                : own ? <TodoPreview name={name} input={input} />
                : name === "update_memory" ? <MemoryDiff text={input.text ?? ""} />
                : <T size={14}>{input.text ?? ""}</T>}
            </View>
            <View className="flex-row justify-end gap-2">
              <Button variant="ghost"
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); respond({ id, approved: false, reason: DECLINED }); }}>Not now</Button>
              <Button onPress={() => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); respond({ id, approved: true }); }}>{yes}</Button>
            </View>
          </View>
        </Animated.View>
      )}
    </Animated.View>
  );
}
