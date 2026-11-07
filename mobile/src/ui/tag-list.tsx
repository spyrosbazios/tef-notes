// Settings' tags: every definition as a row to edit, and the tags notes and tasks carry with no definition (no colour or description until edited), and an Add row. A definition is a name, a colour and a description the
// server's auto-tagger reads. The editor is a sheet; changes go to the server and back, so offline they say so.
import { Plus, Sparkles } from "lucide-react-native";
import { useMemo, useState } from "react";
import { View } from "react-native";
import { Conflict } from "@/core/pocketbase";
import { describeError, describeTag, tagColor, undefinedTags, type TagDef } from "@/core/tags";
import { serverOf } from "@/store/keys";
import { useNotes } from "@/store/notes";
import { deleteTag, saveTag, useTags } from "@/store/tags";
import { useTodo } from "@/store/todo";
import { Swatches } from "./actions";
import { AlertDialog, Button, Input, ListRow, ListSection, Sheet, T } from "./ds";
import { useTheme } from "./use-theme";

type Form = { rec: string | null; name: string; description: string; color?: TagDef["color"] };
const BLANK: Form = { rec: null, name: "", description: "" };

/** A tag's colour as a dot in the row's leading square. */
function Dot({ color }: { color: TagDef["color"] | undefined }) {
  const { NOTE_COLORS } = useTheme();
  const P = NOTE_COLORS[color ?? "gray"];
  return (
    <View className="h-9 w-9 items-center justify-center rounded-xl" style={{ backgroundColor: P.bg }}>
      <View className="h-3.5 w-3.5 rounded-full border" style={{ backgroundColor: P.line, borderColor: P.fg }} />
    </View>
  );
}

export function TagList() {
  const defs = useTags((s) => s.defs), list = useNotes((s) => s.list), tasks = useTodo((s) => s.tasks);
  const loose = useMemo(() => undefinedTags(defs, [...list.map((n) => n.tags), ...Object.values(tasks).map((t) => t.tags)]), [defs, list, tasks]);
  const [form, setForm] = useState<Form | null>(null);
  const [ask, setAsk] = useState<TagDef | null>(null);        // deleting: its confirm
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [writing, setWriting] = useState(false);              // a description being written from the tag's notes
  const server = !!serverOf();

  const open = (f: Form) => { setErr(null); setForm(f); };
  const save = async () => {
    if (!form || !form.name.trim()) return;
    setBusy(true); setErr(null);
    try {
      await saveTag(form.rec, { name: form.name, color: form.color, description: form.description });
      setForm(null);
    } catch (e) {
      setErr(e instanceof Conflict ? "A tag with that name exists." : `Couldn't save: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setBusy(false); }
  };
  /** The server writes a description from the notes that carry the tag; it fills the field and is saved with Save. */
  const generate = async () => {
    const s = serverOf();
    if (!form || !s) return;
    const at = form.rec, name = form.name.trim().replace(/^#/, "");
    setWriting(true); setErr(null);
    try {
      const description = await describeTag(s, name);
      setForm((f) => (f && f.rec === at ? { ...f, description } : f));
    } catch (e) {
      setErr(describeError(e));
    } finally { setWriting(false); }
  };
  const del = async () => {
    const d = ask;
    if (!d) return;
    setAsk(null); setBusy(true);
    try { await deleteTag(d.rec); setForm(null); } catch (e) {
      setErr(`Couldn't delete: ${e instanceof Error ? e.message : String(e)}`);
      setForm({ rec: d.rec, name: d.name, description: d.description, color: d.color });
    } finally { setBusy(false); }
  };

  return (
    <>
      <ListSection title="Tags" footer="The server tags new notes by itself: every tag that likely fits goes on, and one you take off stays off.">
        {defs.map((d) => (
          <ListRow key={d.rec} title={d.name} subtitle={d.description || undefined} leading={<Dot color={tagColor(defs, d.name)} />} chevron
            onPress={() => open({ rec: d.rec, name: d.name, description: d.description, color: d.color })} />
        ))}
        {loose.map((t) => (
          <ListRow key={`loose:${t.name}`} title={t.name} subtitle={`${t.count} ${t.count === 1 ? "item" : "items"}`} leading={<Dot color={undefined} />} chevron
            onPress={() => open({ ...BLANK, name: t.name })} />
        ))}
        {!defs.length && !loose.length ? <ListRow title="No tags yet" subtitle={server ? undefined : "Set a server first: tags are kept there, with the notes."} /> : null}
        {server ? <ListRow title="Add a tag" icon={Plus} onPress={() => open(BLANK)} /> : null}
      </ListSection>

      <Sheet open={!!form} onOpenChange={(o) => { if (!o) setForm(null); }} title={form?.rec ? "Edit tag" : "New tag"}>
        <View className="gap-3">
          <Input value={form?.name ?? ""} onChangeText={(name) => form && setForm({ ...form, name })} placeholder="Name" autoFocus={!form?.rec}
            autoCapitalize="none" autoCorrect={false} accessibilityLabel="Name" />
          <Swatches value={form?.color} onPick={(color) => form && setForm({ ...form, color: color ?? undefined })} />
          <Input value={form?.description ?? ""} onChangeText={(description) => form && setForm({ ...form, description })} placeholder="What it means (for the AI)"
            accessibilityLabel="Description" accessibilityHint="Helps the AI decide which notes get this tag" multiline />
          <Button variant="ghost" size="sm" icon={Sparkles} className="self-start" disabled={busy || !form?.name.trim().replace(/^#/, "")} loading={writing} onPress={generate}>
            Generate from notes
          </Button>
          {err ? <T tone="down" size={12}>{err}</T> : null}
          <View className="flex-row gap-2 pt-1">
            {form?.rec ? (
              <Button variant="destructive" className="flex-1" disabled={busy}
                onPress={() => { const d = defs.find((x) => x.rec === form.rec); if (d) { setForm(null); setAsk(d); } }}>Delete</Button>
            ) : null}
            <Button className="flex-1" disabled={busy || !form?.name.trim()} loading={busy} onPress={save}>Save</Button>
          </View>
        </View>
      </Sheet>

      <AlertDialog open={!!ask} onOpenChange={(o) => { if (!o) setAsk(null); }} title={ask?.name ?? ""} action="Delete" destructive onAction={del}
        description="Delete this tag? Notes keep it in their text, as a plain grey badge, until it is taken off them." />
    </>
  );
}
