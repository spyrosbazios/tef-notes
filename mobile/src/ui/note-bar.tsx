// The note screen's two bars. NoteBar, on top: back, the title (a slot: the field, or text for a note not on the phone yet),
// ⋮ (attach, pin, colour, tags, delete: actions.tsx), and Done while the keyboard is up (it puts the keyboard away: the note is
// always being edited, ui/note.tsx). The date and tags are the second row of the header (ui/note-tags.tsx). FormatBar, while
// the body has the keyboard, on it: every format tool in one row,
// each taking an equal share of the width so none can be pushed off-screen. In a list item that can move, the move
// arrows take the places of heading, quote and code. A tap runs the editor's command in the
// page and leaves the keyboard up (editor.tsx `command`).
import { ArrowDown, ArrowUp, Bold, Check, ChevronLeft, Code, EllipsisVertical, Heading2, Italic, Link2, List, ListTodo, Quote, Redo2, Undo2, type LucideIcon } from "lucide-react-native";
import { useState, type ReactNode } from "react";
import { ActivityIndicator, View } from "react-native";
import { useKeyboardState } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { EditorCommand } from "@/core/editor-bridge";
import { Button, IconButton, Input, Sheet } from "./ds";
import { useTheme } from "./use-theme";

const TOOLS: Record<EditorCommand, { label: string; icon: LucideIcon }> = {
  bold: { label: "Bold", icon: Bold }, italic: { label: "Italic", icon: Italic }, taskList: { label: "Checklist", icon: ListTodo },
  bulletList: { label: "Bulleted list", icon: List }, heading2: { label: "Heading", icon: Heading2 }, link: { label: "Link", icon: Link2 },
  blockquote: { label: "Quote", icon: Quote }, code: { label: "Code", icon: Code },
  moveUp: { label: "Move item up", icon: ArrowUp }, moveDown: { label: "Move item down", icon: ArrowDown }, undo: { label: "Undo", icon: Undo2 }, redo: { label: "Redo", icon: Redo2 },
};
const ORDER = Object.keys(TOOLS) as EditorCommand[];
const MOVE: EditorCommand[] = ["moveUp", "moveDown"], BLOCK: EditorCommand[] = ["heading2", "blockquote", "code"];

type FormatProps = {
  /** The tools that are on at the cursor. */
  active: EditorCommand[];
  onCommand: (name: EditorCommand, arg?: string) => void;
};

export function FormatBar({ active, onCommand }: FormatProps) {
  const { C } = useTheme();
  const insets = useSafeAreaInsets(), keyboard = useKeyboardState((s) => s.isVisible);
  const [linking, setLinking] = useState(false), [href, setHref] = useState("");
  const tool = (name: EditorCommand) => {
    if (name !== "link" || active.includes("link")) { onCommand(name); return; }     // a link under the cursor comes off with no address
    setHref(""); setLinking(true);
  };
  const apply = () => {
    const v = href.trim();
    setLinking(false);
    if (v) onCommand("link", v);
  };

  return (
    <View className="flex-row items-center px-2 border-t border-line bg-bg" style={{ paddingBottom: keyboard ? 0 : insets.bottom }}>
      {ORDER.filter((name) => (active.includes("moveUp") ? !BLOCK.includes(name) : !MOVE.includes(name))).map((name) => {
        const { label, icon: Icon } = TOOLS[name], on = active.includes(name) && !MOVE.includes(name);
        return (
          <IconButton key={name} variant={on ? "tonal" : "ghost"} icon={Icon} size={20} color={on ? C.brand : C.dim} className="flex-1 w-auto" onPress={() => tool(name)}
            label={on && name === "link" ? "Remove link" : label} accessibilityState={{ selected: on }} />
        );
      })}

      <Sheet open={linking} onOpenChange={setLinking} title="Link">
        <View className="flex-row items-center gap-2 pb-4">
          <Input value={href} onChangeText={setHref} onSubmitEditing={apply} placeholder="https://…" autoFocus autoCapitalize="none" autoCorrect={false} keyboardType="url"
            returnKeyType="done" submitBehavior="submit" containerClassName="flex-1" className="text-[14px]" />
          <Button size="sm" onPress={apply} disabled={!href.trim()}>Link</Button>
        </View>
      </Sheet>
    </View>
  );
}

type Props = {
  top: number;
  /** The keyboard is up: Done shows. Missing (not downloaded yet): back only. */
  typing: boolean;
  missing: boolean;
  /** An attach is under way. */
  attaching: boolean;
  onBack: () => void;
  onDone: () => void;
  onMenu: () => void;
  /** The title, between back and the actions. */
  children: ReactNode;
};

export function NoteBar({ top, typing, missing, attaching, onBack, onDone, onMenu, children }: Props) {
  const { C } = useTheme();
  return (
    <View className="min-h-14 flex-row items-center gap-1 px-2" style={{ paddingTop: top }}>
      <IconButton label="Back" icon={ChevronLeft} size={26} color={C.fg} onPress={onBack} />
      <View className="flex-1 justify-center py-1">{children}</View>
      {!missing && (
        <>
          {attaching ? <View className="h-12 w-12 items-center justify-center"><ActivityIndicator size="small" color={C.dim} /></View> : null}
          <IconButton label="Note options" icon={EllipsisVertical} size={22} color={C.dim} onPress={onMenu} />
          {typing ? <Button size="sm" icon={Check} onPress={onDone} accessibilityLabel="Done: put the keyboard away" className="ml-1 mr-1">Done</Button> : null}
        </>
      )}
    </View>
  );
}
