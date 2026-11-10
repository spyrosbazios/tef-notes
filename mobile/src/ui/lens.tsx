// Lenses on the phone (core/lens.ts, store/lenses.ts). `LensSwitcher` is the app's mark in Home's header, the only place a lens is picked, made,
// edited or deleted: the logo alone while none is on, else the logo and the lens's name beside it; a tap opens a sheet of every lens (tap one
// to switch to it, the pencil edits it) and "No lens".
// The form is a name, tags and hidden tags, picked with the tag picker over a plain list of names (tag-dialog.tsx, tag-targets.ts listTagTarget);
// the sheets open one after the other, never over each other (a Modal on a Modal). No other tab shows the lens: the tab bar carries no chip.
import { Check, ChevronDown, Pencil, Plus, X } from "lucide-react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";
import * as Haptics from "expo-haptics";
import { LENS_NAME_MAX, lensProblem, type Lens, type LensAccentName } from "@/core/lens";
import { ACCENT_NAMES, ACCENTS, accentColor, THEMES, type ThemeName } from "@/core/theme";
import { usePrefs } from "@/store/prefs";
import { fold } from "@/core/notes";
import { serverOf } from "@/store/keys";
import { deleteLens, saveLens, setActiveLens, useActiveLens, useLenses } from "@/store/lenses";
import { AlertDialog, Button, Chip, IconButton, Input, ListRow, ListSection, Sheet, T } from "./ds";
import { Logo } from "./logo";
import { TagDialog } from "./tag-dialog";
import { listTagTarget } from "./tag-targets";
import { useTheme } from "./use-theme";

type Form = { rec: string | null; name: string; tags: string[]; exclude: string[]; accent: LensAccentName | null; theme: ThemeName | null };
type Field = "tags" | "exclude";
const BLANK: Form = { rec: null, name: "", tags: [], exclude: [], accent: null, theme: null };
const formOf = (l: Lens): Form => ({ rec: l.rec, name: l.name, tags: l.tags, exclude: l.exclude, accent: l.accent, theme: l.theme });

/** The colour the app takes while the lens is on: the first dot (dashed) is none, the phone's own primary colour. */
function LensAccent({ value, onChange }: { value: LensAccentName | null; onChange: (a: LensAccentName | null) => void }) {
  const theme = useTheme(), own = usePrefs((s) => s.accent);
  const label = (a: LensAccentName | null) => (a ? ACCENTS[a].label : "The phone's own");
  return (
    <View className="flex-row flex-wrap gap-2">
      {ACCENT_NAMES.map((a) => {
        const pick = a === "theme" ? null : a, on = pick === value, colour = accentColor(THEMES[theme.name], a === "theme" ? own : a);
        return (
          <Pressable key={a} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={label(pick)} hitSlop={4}
            onPress={() => { if (!on) { void Haptics.selectionAsync(); onChange(pick); } }}
            className="h-11 w-11 items-center justify-center rounded-full border-2 active:opacity-80" style={{ borderColor: on ? colour : "transparent" }}>
            <View className={a === "theme" ? "h-8 w-8 items-center justify-center rounded-full border-2 border-dashed border-bg" : "h-8 w-8 items-center justify-center rounded-full"}
              style={{ backgroundColor: colour }}>
              {on ? <Check size={16} color={theme.C.bg} strokeWidth={3} /> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
const subtitleOf = (l: Lens) => [...l.tags.map((t) => `#${t}`), ...l.exclude.map((t) => `not #${t}`)].join(" ");

/** The control in Home's header and everything it opens. */
export function LensSwitcher() {
  const { C } = useTheme();
  const lens = useActiveLens();
  const lenses = useLenses((s) => s.lenses);
  const [open, setOpen] = useState(false);                    // the list of lenses
  const [form, setForm] = useState<Form | null>(null);        // a lens being made or edited
  const [picking, setPicking] = useState<Field | null>(null); // its tag picker (for which list), in place of the form while open
  const [ask, setAsk] = useState<Lens | null>(null);          // deleting: its confirm
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const server = !!serverOf();

  const edit = (f: Form) => { setErr(null); setOpen(false); setForm(f); };
  const choose = (rec: string | null) => { setActiveLens(rec); setOpen(false); };
  const save = async () => {
    if (!form) return;
    const problem = lensProblem(form);
    if (problem) { setErr(problem); return; }
    setBusy(true); setErr(null);
    try {
      await saveLens(form.rec, form);
      setForm(null);
    } catch (e) {
      setErr(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setBusy(false); }
  };
  const del = async () => {
    const l = ask;
    if (!l) return;
    setAsk(null); setBusy(true);
    try { await deleteLens(l.rec); } catch (e) {
      setErr(`Couldn't delete: ${e instanceof Error ? e.message : String(e)}`);
      setForm(formOf(l));
    } finally { setBusy(false); }
  };
  const field: Field = picking ?? "tags";
  const target = listTagTarget(field === "tags" ? "Lens tags" : "Hidden tags", form?.[field] ?? [], (v) => setForm((f) => (f ? { ...f, [field]: v } : f)));
  const unpick = (k: Field, name: string) => setForm((f) => (f ? { ...f, [k]: f[k].filter((t) => fold(t) !== fold(name)) } : f));

  return (
    <>
      <Pressable onPress={() => { void Haptics.selectionAsync(); setOpen(true); }} accessibilityRole="button" hitSlop={6}
        accessibilityLabel={lens ? `Lens: ${lens.name}. Change it` : "Lens: none. Pick one"}
        className={lens ? "h-10 max-w-[75%] flex-row items-center gap-2 self-start rounded-full bg-accent pl-1.5 pr-3 active:opacity-70" : "h-10 flex-row items-center gap-1 self-start active:opacity-70"}>
        <Logo size={28} />
        {lens ? <T tone="brand" font="semi" size={14} numberOfLines={1} className="shrink">{lens.name}</T> : null}
        <ChevronDown size={14} color={lens ? C.brand : C.dim} />
      </Pressable>

      <Sheet open={open} onOpenChange={setOpen} title="Lens" scroll>
        <ListSection footer="A lens shows only the notes and tasks that carry any of its tags and none it hides, in every tab and in what you ask the assistant. What you make while one is on gets its first tag.">
          <ListRow title="No lens" subtitle="Everything, unfiltered" selected={!lens} onPress={() => choose(null)}
            trailing={!lens ? <Check size={20} color={C.brand} /> : undefined} />
          {lenses.map((l) => (
            <ListRow key={l.rec} title={l.name} subtitle={subtitleOf(l)} selected={lens?.rec === l.rec} onPress={() => choose(l.rec)}
              trailing={(
                <View className="flex-row items-center gap-1">
                  {lens?.rec === l.rec ? <Check size={20} color={C.brand} /> : null}
                  <IconButton compact label={`Edit lens ${l.name}`} icon={Pencil} size={18} color={C.dim} onPress={() => edit(formOf(l))} />
                </View>
              )} />
          ))}
          {server
            ? <ListRow title="New lens" icon={Plus} onPress={() => edit(BLANK)} />
            : <ListRow title="No server set" subtitle="Lenses are kept on the server, so every device has them. Set it in Settings first." />}
        </ListSection>
      </Sheet>

      <Sheet open={!!form && !picking} onOpenChange={(o) => { if (!o) setForm(null); }} title={form?.rec ? "Edit lens" : "New lens"} scroll>
        <View className="gap-3 px-5">
          <Input value={form?.name ?? ""} onChangeText={(name) => form && setForm({ ...form, name })} placeholder="Name, such as Work" autoFocus={!form?.rec}
            maxLength={LENS_NAME_MAX} accessibilityLabel="Lens name" />
          <T variant="label" className="px-1">Tags</T>
          <View className="flex-row flex-wrap gap-2">
            {form?.tags.map((t) => (
              <Chip key={t} size="sm" label={t} selected onPress={() => unpick("tags", t)} accessibilityLabel={`Remove the tag ${t}`}>
                <X size={13} color={C.brand} />
              </Chip>
            ))}
            <Chip size="sm" icon={Plus} label={form?.tags.length ? "Add" : "Pick tags"} onPress={() => setPicking("tags")} accessibilityLabel="Pick tags" />
          </View>
          <T variant="label" className="px-1">Hide</T>
          <View className="flex-row flex-wrap gap-2">
            {form?.exclude.map((t) => (
              <Chip key={t} size="sm" label={`not ${t}`} onPress={() => unpick("exclude", t)} accessibilityLabel={`Stop hiding the tag ${t}`}>
                <X size={13} color={C.dim} />
              </Chip>
            ))}
            <Chip size="sm" icon={Plus} label={form?.exclude.length ? "Add" : "Pick tags to hide"} onPress={() => setPicking("exclude")} accessibilityLabel="Pick tags to hide" />
          </View>
          <T variant="label" className="px-1">Colour while on</T>
          <LensAccent value={form?.accent ?? null} onChange={(accent) => setForm((f) => (f ? { ...f, accent } : f))} />
          <T tone="dim" size={13} className="px-1">The first tag goes on what you make while this lens is on. Anything carrying a hidden tag is left out.</T>
          {err ? <T tone="down" size={12}>{err}</T> : null}
          <View className="flex-row gap-2 pt-1">
            {form?.rec ? (
              <Button variant="destructive" className="flex-1" disabled={busy}
                onPress={() => { const l = lenses.find((x) => x.rec === form.rec); if (l) { setForm(null); setAsk(l); } }}>Delete</Button>
            ) : null}
            <Button className="flex-1" disabled={busy || !form?.name.trim()} loading={busy} onPress={save}>Save</Button>
          </View>
        </View>
      </Sheet>
      <TagDialog target={target} open={!!picking && !!form} onClose={() => setPicking(null)} />

      <AlertDialog open={!!ask} onOpenChange={(o) => { if (!o) setAsk(null); }} title={ask?.name ?? ""} action="Delete" destructive onAction={del}
        description="Delete this lens? It goes from every device. Notes and tasks keep their tags." />
    </>
  );
}

