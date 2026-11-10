// The lens switcher, at the bottom of the rail (and, as the app's mark, in Home's header on a phone): pick the lens on, or none (every device follows), make, edit and delete lenses.
// A lens is a name, tags and hidden tags (core/lens.ts): while one is on, every list shows only what carries any of its tags and none of the hidden, and what is made
// carries its first tag. The definitions are the server's, shared by every device; which one is on is a preference too (hooks/prefs.ts).
import { Check, ChevronDown, Focus, Pencil, Plus, Trash2, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { lensProblem, LENS_NAME_MAX, type Lens, type LensAccentName } from "@/core/lens";
import { fold } from "@/core/notes";
import { ACCENT_NAMES, ACCENTS, accentColor, THEME_NAMES, THEMES, type ThemeName } from "@/core/theme";
import { useAppearance } from "@/hooks/appearance";
import { Mark } from "@/components/brand";
import { Turns } from "@/components/swap";
import { TagEditor } from "@/components/tag-editor";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { FormSheet, SheetForm, useInDrawer } from "@/components/form-sheet";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useShake } from "@/hooks/shake";
import { setActiveLens, useActiveLens, useCreateLens, useLenses, useRemoveLens, useUpdateLens } from "@/hooks/lens";
import { Conflict } from "@/core/pocketbase";
import { message } from "@/services/api";
import { cn } from "@/lib/utils";

const NONE = "";
const add = (c: string[], t: string) => (c.some((x) => fold(x) === fold(t)) ? c : [...c, t]);

/** The name and tags of a lens, made or edited. `lens` undefined: a new one, which is turned on once it is made. In the phone's
 *  sheet the keyboard is not raised unasked. */
function LensForm({ lens, onDone }: { lens?: Lens; onDone: () => void }) {
  const sheet = useInDrawer();
  const create = useCreateLens(), update = useUpdateLens(), { data: all = [] } = useLenses();
  const [name, setName] = useState(lens?.name ?? ""), [tags, setTags] = useState<string[]>(lens?.tags ?? []);
  const [exclude, setExclude] = useState<string[]>(lens?.exclude ?? []);
  const [accent, setAccent] = useState<LensAccentName | null>(lens?.accent ?? null);
  const [theme, setTheme] = useState<ThemeName | null>(lens?.theme ?? null);
  const problem = lensProblem({ name, tags, exclude }), taken = all.some((l) => l.rec !== lens?.rec && fold(l.name) === fold(name.trim()));
  const [field, shake] = useShake<HTMLInputElement>(), takenId = useId(), nameId = useId();
  useEffect(() => { if (taken) shake(); }, [taken, shake]);   // once, as the name becomes one that exists
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (problem || taken) return;
    try {
      if (lens) await update.mutateAsync({ rec: lens.rec, fields: { name, tags, exclude, accent, theme } });
      else setActiveLens((await create.mutateAsync({ name, tags, exclude, accent, theme })).rec);
      onDone();
    } catch (x) {
      if (x instanceof Conflict) shake();
      toast.error(x instanceof Conflict ? "A lens by that name exists." : message(x));
    }
  };
  const busy = create.isPending || update.isPending;
  return (
    <SheetForm title={lens ? "Edit lens" : "New lens"} description="Every list shows only what matches, until you turn it off." onSubmit={save} className="space-y-5" actions={<>
      <Button type="button" variant="ghost" className="rounded-full" onClick={onDone}>Cancel</Button>
      <Button type="submit" className="rounded-full" disabled={busy || !!problem || taken}><Turns aria-live="polite" state={busy ? "busy" : "idle"} states={{ idle: "Save", busy: "Saving…" }} /></Button>
    </>}>
      <Field label="Name" htmlFor={nameId}>
        <Input id={nameId} ref={field} autoFocus={!sheet} value={name} maxLength={LENS_NAME_MAX} aria-invalid={taken || undefined} aria-describedby={taken ? takenId : undefined} onChange={(e) => setName(e.target.value)} placeholder="e.g. Work" />
        {taken ? <p id={takenId} role="alert" className="text-xs text-down">A lens by that name exists.</p> : null}
      </Field>
      <Field label="Show" hint="Items with any of these. New items get the first.">
        <div className="flex flex-wrap items-center gap-1.5">
          <TagEditor tags={tags} onAdd={(t) => setTags((c) => add(c, t))} onRemove={(t) => setTags((c) => c.filter((x) => x !== t))} />
        </div>
      </Field>
      <Field label="Hide" hint="Items with any of these are left out.">
        <div className="flex flex-wrap items-center gap-1.5">
          <TagEditor tags={exclude} onAdd={(t) => setExclude((c) => add(c, t))} onRemove={(t) => setExclude((c) => c.filter((x) => x !== t))} />
        </div>
      </Field>
      <LensTheme value={theme} onChange={setTheme} />
      <LensAccent value={accent} theme={theme} onChange={setAccent} />
      {problem && (tags.length || exclude.length) ? <p className="text-xs text-down">{problem}</p> : null}
    </SheetForm>
  );
}

/** A labelled part of the lens form: its name, an optional one-line hint, then its control. */
function Field({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div>
        <Label htmlFor={htmlFor} className="text-sm font-semibold">{label}</Label>
        {hint ? <p className="text-xs text-dim">{hint}</p> : null}
      </div>
      {children}
    </div>
  );
}

/** The primary colour the app takes while the lens is on: none (this browser's own accent) or one of the accents, in one row that scrolls sideways. */
function LensAccent({ value, theme: picked, onChange }: { value: LensAccentName | null; theme: ThemeName | null; onChange: (a: LensAccentName | null) => void }) {
  const { theme: ownTheme, accent: own } = useAppearance(), theme = picked ?? ownTheme, headId = useId();
  const label = (a: LensAccentName | null) => (a ? ACCENTS[a].label : "This browser's own");
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <p id={headId} className="text-sm font-semibold">Colour</p>
        <span className="text-xs text-dim">{label(value)}</span>
      </div>
      <div role="radiogroup" aria-labelledby={headId} className="-mx-1 flex gap-1 overflow-x-auto px-1 py-0.5 [scrollbar-width:none]">
        {ACCENT_NAMES.map((a) => {
          const pick = a === "theme" ? null : a, on = pick === value, colour = accentColor(THEMES[theme], a === "theme" ? own : a);
          return (
            <button key={a} type="button" role="radio" aria-checked={on} aria-label={label(pick)} title={label(pick)} onClick={() => onChange(pick)}
              className="grid size-9 shrink-0 place-items-center rounded-full border-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring"
              style={{ borderColor: on ? colour : "transparent" }}>
              <span className={cn("grid size-6 place-items-center rounded-full", a === "theme" && "border-2 border-dashed border-bg")} style={{ backgroundColor: colour }}>
                {on ? <Check className="size-3.5 text-bg" strokeWidth={3} /> : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The theme the app takes while the lens is on: none (the owner's own) or one of the themes, each a swatch of its ground and
 *  brand, in one row that scrolls sideways. */
function LensTheme({ value, onChange }: { value: ThemeName | null; onChange: (t: ThemeName | null) => void }) {
  const { theme: own } = useAppearance(), headId = useId();
  const label = (t: ThemeName | null) => (t ? THEMES[t].label : "Your own");
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <p id={headId} className="text-sm font-semibold">Theme</p>
        <span className="text-xs text-dim">{label(value)}</span>
      </div>
      <div role="radiogroup" aria-labelledby={headId} className="-mx-1 flex gap-1 overflow-x-auto px-1 py-0.5 [scrollbar-width:none]">
        {[null, ...THEME_NAMES].map((t) => {
          const on = t === value, { C } = THEMES[t ?? own];
          return (
            <button key={t ?? "own"} type="button" role="radio" aria-checked={on} aria-label={label(t)} title={label(t)} onClick={() => onChange(t)}
              className="grid size-9 shrink-0 place-items-center rounded-full border-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring"
              style={{ borderColor: on ? C.brand : "transparent" }}>
              <span className={cn("grid size-6 place-items-center overflow-hidden rounded-full border border-line", t === null && "border-2 border-dashed")}
                style={{ background: `linear-gradient(135deg, ${C.bg} 50%, ${C.brand} 50%)` }}>
                {on ? <Check className="size-3.5" style={{ color: C.fg }} strokeWidth={3} /> : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** `header`: Home's header on a phone, where the app's mark is the control, with the lens's name ("All" while none is on) and a chevron beside it, so it reads as a picker. */
/** `folded`: the desktop rail is down to its icons, so the name fades out under the clip and the off button goes. */
export function LensSwitcher({ header = false, folded = false }: { header?: boolean; folded?: boolean }) {
  const { data: lenses = [] } = useLenses(), active = useActiveLens(), remove = useRemoveLens();
  const [form, setForm] = useState<{ lens?: Lens } | null>(null), [asking, setAsking] = useState<Lens | null>(null);
  const del = (l: Lens) => {
    remove.mutate(l, { onSuccess: () => { if (active?.rec === l.rec) setActiveLens(null); }, onError: (x) => toast.error(message(x)) });
  };
  return (
    <>
      <div className="flex items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {header ? (
            <button type="button" aria-label={active ? `Lens: ${active.name}` : "Lens: none"}
              className="flex h-11 min-w-0 items-center gap-2.5 rounded-lg pr-2 text-left transition-opacity active:opacity-60">
              <Mark className="size-7 shrink-0 text-brand" />
              <span className={cn("truncate text-[15px] font-extrabold tracking-tight", active ? "text-brand" : "text-dim")}>{active ? active.name : "All"}</span>
              <ChevronDown className={cn("size-4 shrink-0", active ? "text-brand" : "text-dim")} />
            </button>
          ) : (
            <button type="button" aria-label={active ? `Lens: ${active.name}` : "Lens: none"}
              className={cn("flex h-8 min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 text-left text-sm transition-colors",
                active ? "bg-brand/15 font-semibold text-brand" : "text-dim hover:bg-muted hover:text-fg")}>
              <Focus className="size-4 shrink-0" />
              <span className={cn("flex-1 whitespace-nowrap transition-opacity", folded ? "opacity-0" : "truncate")}>{active ? active.name : "Lens"}</span>
            </button>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent side={header ? "bottom" : "top"} align="start" className="w-56">
          <DropdownMenuRadioGroup value={active?.rec ?? NONE} onValueChange={(v) => setActiveLens(v || null)}>
            <DropdownMenuRadioItem value={NONE}>No lens</DropdownMenuRadioItem>
            {lenses.map((l) => <DropdownMenuRadioItem key={l.rec} value={l.rec}><span className="truncate">{l.name}</span></DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setForm({})}><Plus /> New lens…</DropdownMenuItem>
          {active ? (
            <>
              <DropdownMenuItem onSelect={() => setForm({ lens: active })}><Pencil /> Edit “{active.name}”…</DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => setAsking(active)}><Trash2 /> Delete “{active.name}”…</DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {active && !header && !folded ? (
        <button type="button" onClick={() => setActiveLens(null)} title={`Turn off the lens ${active.name}`} aria-label={`Turn off the lens ${active.name}`}
          className="grid size-8 shrink-0 place-items-center rounded-lg text-brand transition-colors hover:bg-brand/15">
          <X className="size-4" />
        </button>
      ) : null}
      </div>

      <FormSheet open={form != null} onClose={() => setForm(null)}>{form ? <LensForm key={form.lens?.rec ?? "new"} lens={form.lens} onDone={() => setForm(null)} /> : null}</FormSheet>
      <AlertDialog open={asking != null} onOpenChange={(o) => { if (!o) setAsking(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete the lens “{asking?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>The lens goes from every device. Its tags, notes and tasks stay as they are.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => { if (asking) del(asking); }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** A small "lens on" chip for the narrow top bar, where the rail (and its switcher) is closed: tap to turn it off. */
export function LensChip() {
  const active = useActiveLens();
  if (!active) return null;
  return (
    <button type="button" onClick={() => setActiveLens(null)} title={`Lens ${active.name} is on: tap to turn it off`} aria-label={`Turn off the lens ${active.name}`}
      className="inline-flex h-6 max-w-32 items-center gap-1 rounded-full bg-brand/15 px-2 text-xs font-semibold text-brand">
      <Focus className="size-3 shrink-0" /><span className="truncate">{active.name}</span><X className="size-3 shrink-0 opacity-70" />
    </button>
  );
}
