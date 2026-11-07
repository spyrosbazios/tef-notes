// The attach sheet: choose a photo from the gallery, take one, or pick a PDF; the store does the rest (store/attachments.ts:
// downscale, save, queue the upload) and hands back the body's lines for what was added. Opened from the note screen's ⋮
// menu (ui/actions.tsx), which puts those lines where each mode writes (ui/note.tsx).
import { Camera, FileText, Images } from "lucide-react-native";
import { View } from "react-native";
import { pickAndAttach, type Source } from "@/store/attachments";
import { Action } from "./actions";
import { Sheet } from "./ds";
import { useTheme } from "./use-theme";

type Props = {
  noteId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The body's lines for what was just attached. */
  onAttached: (markdown: string) => void;
  /** Why an attach failed; null when a new one starts. */
  onError: (message: string | null) => void;
  /** An attach is under way (the picker is open, or the file is being saved). */
  onBusy: (busy: boolean) => void;
};

export function AttachSheet({ noteId, open, onOpenChange, onAttached, onError, onBusy }: Props) {
  const { C } = useTheme();

  const attach = async (source: Source) => {
    onError(null); onBusy(true);
    try {
      const r = await pickAndAttach(noteId, source);
      if (r) onAttached(r.markdown);
    } catch (e) {
      onError(`Couldn't attach it: ${e instanceof Error ? e.message : String(e)}`);
    } finally { onBusy(false); }
  };
  const choose = (source: Source) => { onOpenChange(false); void attach(source); };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Attach to this note">
      <View>
        <Action icon={<Images size={22} color={C.dim} />} label="Choose from the gallery" onPress={() => choose("library")} />
        <Action icon={<Camera size={22} color={C.dim} />} label="Take a photo" onPress={() => choose("camera")} />
        <Action icon={<FileText size={22} color={C.dim} />} label="Choose a PDF" onPress={() => choose("document")} />
      </View>
    </Sheet>
  );
}
