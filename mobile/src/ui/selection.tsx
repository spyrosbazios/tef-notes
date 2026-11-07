// The notes list's header while notes are selected: a count and everything the per-note menu offers (pin,
// colour, tags, delete), applied to all of them, and the hand-off to the agent and the export. Flags and tags are local writes that sync pushes later; one confirm
// guards the delete.
import * as Haptics from "expo-haptics";
import { Palette, Pin, PinOff, Share2, Sparkles, Tag, Trash2, X } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colorPatch, pinPatch } from "@/core/bulk";
import { askAbout, exportNotes } from "@/store/note-out";
import { useNotes, type FlagPatch } from "@/store/notes";
import { Swatches } from "./actions";
import { Button, Dialog, IconButton, Sheet, T } from "./ds";
import { TagDialog } from "./tag-dialog";
import { useNoteTags } from "./tag-targets";
import { useTheme } from "./use-theme";

/** `paths` are the selected notes; `onExit` drops the selection; `onReflow` runs just before a change that moves tiles
 *  (pin, delete), so the list can animate them to their new places. */
export function SelectionBar({ paths, onExit, onReflow }: { paths: string[]; onExit: () => void; onReflow: () => void }) {
  const { C } = useTheme();
  const insets = useSafeAreaInsets();
  const notes = useNotes((s) => s.notes);
  const metas = paths.flatMap((p) => (notes[p] ? [notes[p]] : []));
  const [colour, setColour] = useState(false), [tagging, setTagging] = useState(false), [asking, setAsking] = useState(false);
  const flag = (patch: FlagPatch) => { Haptics.selectionAsync(); for (const n of metas) useNotes.getState().setFlags(n.path, patch); };
  const allPinned = metas.every((n) => n.pinned);
  const del = () => { setAsking(false); onReflow(); for (const n of metas) useNotes.getState().remove(n.path); onExit(); };
  const one = metas.length === 1 ? metas[0] : null;
  const tags = useNoteTags(paths);

  return (
    <View className="flex-row items-center px-2 pb-2" style={{ paddingTop: insets.top + 8 }}>
      <IconButton compact label="Clear selection" icon={X} color={C.fg} onPress={onExit} />
      <T font="heavy" size={18} numberOfLines={1} className="flex-1 ml-1">{metas.length} selected</T>
      <IconButton compact label={allPinned ? "Unpin" : "Pin to top"} icon={allPinned ? PinOff : Pin} color={C.dim} size={20}
        onPress={() => { onReflow(); flag(pinPatch(metas)); }} />
      <IconButton compact label="Colour" icon={Palette} color={C.dim} size={20} onPress={() => setColour(true)} />
      <IconButton compact label="Tags" icon={Tag} color={C.dim} size={20} onPress={() => setTagging(true)} />
      <IconButton compact label="Ask about these" icon={Sparkles} color={C.dim} size={20} onPress={() => { Haptics.selectionAsync(); askAbout(paths); onExit(); }} />
      <IconButton compact label="Export" icon={Share2} color={C.dim} size={20} onPress={() => { Haptics.selectionAsync(); void exportNotes(paths); }} />
      <IconButton compact label="Delete" icon={Trash2} color={C.down} size={20}
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setAsking(true); }} />

      <Sheet open={colour} onOpenChange={setColour} title="Colour">
        <View className="pb-4">
          <Swatches value={one?.color} onPick={(c) => { flag(colorPatch(c)); setColour(false); }} />
        </View>
      </Sheet>

      <TagDialog target={tags} open={tagging} onClose={() => setTagging(false)} />

      <Dialog open={asking} onOpenChange={setAsking}>
        <Dialog.Content>
          <Dialog.Title>{one ? one.title : `${metas.length} notes`}</Dialog.Title>
          <Dialog.Description>
            {one ? "Delete this note and its photos?" : `Delete these ${metas.length} notes and their photos?`} They go from the server too on the next sync, and nothing keeps a copy.
          </Dialog.Description>
          <Dialog.Footer>
            <Dialog.Close><Button variant="ghost">Cancel</Button></Dialog.Close>
            <Button variant="destructive" onPress={del}>Delete</Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog>
    </View>
  );
}
