// A task's notes. Plain text is a multiline field, as it always was. Once the notes hold markdown (a link, emphasis, a list,
// a picture: the clipper's and the agent's image lines, or a note's photo) they are read as markdown instead, each typed line kept, the pictures drawn and tapped open in the
// photo viewer as a note's are; the pencil, or a tap on the text, brings the field back, and leaving it (blur) returns
// to the read view. Pictures of a note's not yet on this phone are fetched as they are drawn (store/attachments.ts).
import { Pencil } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { EnrichedMarkdownText } from "react-native-enriched-markdown";
import { attachmentsIn, imagesOf, readsAsMarkdown, resolveAttachments, withLineBreaks } from "@/core/task-notes";
import { ensureAttachment, resolveAttachment } from "@/store/attachments";
import type { useDraft } from "@/ui/draft";
import { IconButton } from "@/ui/ds";
import { FLAGS, openLink, openPhotos, useMarkdownStyle } from "@/ui/note";
import { useTheme } from "@/ui/use-theme";

const INDENT = 20 + 26 + 14;                    // under the title, past the box

/** `md` with its attachment pictures pointed at their copies on this phone, each fetched when it isn't here yet and drawn as it lands. */
function useShown(md: string): string {
  const [landed, setLanded] = useState<Record<string, string>>({});
  const need = useMemo(() => attachmentsIn(md).filter((a) => !resolveAttachment(a.noteId, a.name)), [md]);
  useEffect(() => {
    let live = true;
    for (const { noteId, name } of need) {
      ensureAttachment(noteId, name).then((uri) => { if (uri && live) setLanded((l) => ({ ...l, [`${noteId}/${name}`]: uri })); }, () => {});
    }
    return () => { live = false; };
  }, [need]);
  return useMemo(() => resolveAttachments(md, (noteId, name) => resolveAttachment(noteId, name) ?? landed[`${noteId}/${name}`]), [md, landed]);
}

export function TaskNotes({ draft }: { draft: ReturnType<typeof useDraft> }) {
  const { C } = useTheme();
  const md = useMarkdownStyle();
  const [editing, setEditing] = useState(false);
  const shown = useShown(draft.value);
  const pictures = useMemo(() => imagesOf(shown), [shown]);

  if (!readsAsMarkdown(shown) || editing) {
    return (
      <TextInput {...draft} onFocus={() => { draft.onFocus(); setEditing(true); }} onBlur={() => { draft.onBlur(); setEditing(false); }} autoFocus={editing}
        multiline placeholder="Notes" placeholderTextColor={C.faint} accessibilityLabel="Notes" textAlignVertical="top"
        className="px-5 pb-3 pt-1 font-sans text-fg" style={{ fontSize: 15, lineHeight: 22, minHeight: 64, paddingLeft: INDENT }} />
    );
  }
  return (
    <View className="flex-row items-start pb-2 pr-2 pt-1" style={{ paddingLeft: INDENT }}>
      <Pressable className="flex-1" accessibilityRole="button" accessibilityLabel="Edit the notes" onPress={() => setEditing(true)}>
        <EnrichedMarkdownText flavor="github" markdown={withLineBreaks(shown)} markdownStyle={md} md4cFlags={FLAGS}
          onImagePress={({ url }) => openPhotos(pictures, Math.max(0, pictures.indexOf(url)))}
          onLinkPress={({ url }) => openLink(url)} />
      </Pressable>
      <IconButton compact label="Edit the notes" icon={Pencil} size={16} color={C.dim} onPress={() => setEditing(true)} />
    </View>
  );
}
