// A note's flags, colour, tags, hand-off to the agent, export and delete, from a long-press on a list card or a note's own ⋮. One sheet per screen, not one per row. Delete asks first: the note goes from the server on the next sync, for good.
import * as Haptics from "expo-haptics";
import { Check, Paperclip, Pin, PinOff, Share2, Sparkles, Tag, Trash2 } from "lucide-react-native";
import { useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { cap } from "@/core/agent";
import { COLORS, type Color } from "@/core/notes";
import { exportNotes, askAbout } from "@/store/note-out";
import { useNotes, type NoteMeta } from "@/store/notes";
import { AlertDialog, Sheet, T, Touchable } from "./ds";
import { TagDialog } from "./tag-dialog";
import { useNoteTags } from "./tag-targets";
import { useTheme } from "./use-theme";

/** One row of a sheet: an icon and a verb, 56dp. */
export function Action({ icon, label, tone = "fg", onPress }: { icon: ReactNode; label: string; tone?: "fg" | "down"; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" className="-mx-2 h-14 flex-row items-center gap-4 rounded-2xl px-2 active:bg-muted">
      {icon}
      <T tone={tone} font="medium" size={16}>{label}</T>
    </Pressable>
  );
}

/** The card tints (`COLORS`, nine: one row on a phone); the note's own is ringed, and tapping it again takes the tint off (`onPick(null)`). */
export function Swatches({ value, onPick }: { value?: Color; onPick: (c: Color | null) => void }) {
  const { NOTE_COLORS } = useTheme();
  return (
    <View className="flex-row items-center justify-between py-3">
      {COLORS.map((c) => {
        const on = c === value, P = NOTE_COLORS[c];
        return (
          <Touchable key={c} onPress={() => onPick(on ? null : c)} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={cap(c)}
            className="w-9 h-9 rounded-full items-center justify-center border-2" style={{ backgroundColor: P.bg, borderColor: on ? P.fg : P.line }}>
            {on ? <Check size={16} color={P.fg} strokeWidth={2.6} /> : null}
          </Touchable>
        );
      })}
    </View>
  );
}

/** `path` open, null shut. `onAttach` (the note's own screen) adds "Attach a photo or PDF" at the top. */
export function NoteMenu({ path, onClose, onDeleted, onAttach }: { path: string | null; onClose: () => void; onDeleted?: () => void; onAttach?: () => void }) {
  const { C } = useTheme();
  const live = useNotes((s) => (path ? s.notes[path] : undefined));
  const [note, setNote] = useState(live);
  if (live && live !== note) setNote(live);              // kept through the sheet's closing slide
  const [del, setDel] = useState<NoteMeta | null>(null);
  const [tagging, setTagging] = useState(false);
  const tags = useNoteTags(note ? [note.path] : []);
  const { setFlags, remove } = useNotes.getState();
  const act = (f: () => void) => { Haptics.selectionAsync(); f(); onClose(); };

  return (
    <>
      <Sheet open={!!live} onOpenChange={(o) => { if (!o) onClose(); }} title={note?.title ?? ""}>
        {note && (
          <View>
            {onAttach ? <Action icon={<Paperclip size={22} color={C.dim} />} label="Attach a photo or PDF" onPress={() => { Haptics.selectionAsync(); onClose(); onAttach(); }} /> : null}
            <Action icon={note.pinned ? <PinOff size={22} color={C.dim} /> : <Pin size={22} color={C.dim} />} label={note.pinned ? "Unpin" : "Pin to top"}
              onPress={() => act(() => setFlags(note.path, { pinned: !note.pinned }))} />
            <Swatches value={note.color} onPick={(c) => act(() => setFlags(note.path, { color: c }))} />
            <Action icon={<Tag size={22} color={C.dim} />} label="Tags…" onPress={() => { Haptics.selectionAsync(); onClose(); setTagging(true); }} />
            <Action icon={<Sparkles size={22} color={C.dim} />} label="Ask about this note" onPress={() => act(() => askAbout([note.path]))} />
            <Action icon={<Share2 size={22} color={C.dim} />} label="Export…" onPress={() => act(() => { void exportNotes([note.path]); })} />
            <Action icon={<Trash2 size={22} color={C.down} />} label="Delete" tone="down"
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onClose(); setDel(note); }} />
          </View>
        )}
      </Sheet>

      <TagDialog target={tags} open={tagging} onClose={() => setTagging(false)} />

      <AlertDialog open={!!del} onOpenChange={(o) => { if (!o) setDel(null); }} title={del?.title ?? ""} action="Delete" destructive
        description="Delete this note and its photos? They go from the server too on the next sync, and nothing keeps a copy."
        onAction={() => { if (del) { remove(del.path); onDeleted?.(); } setDel(null); }} />
    </>
  );
}
