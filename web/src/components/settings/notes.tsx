// Settings → Notes: per layout, the editor's format tools (core/format-tools.ts: dragged into order; in the bar, under its ⋯,
// or off), the desktop's bar over selected words (the same file: dragged into order, each shown or not) and where each of a note's actions sits in its header (core/note-actions.ts: dragged into order; a button in the
// header, a row in the menu, or off), and the assistant actions themselves: the owner's saved prompts, added, changed and
// deleted here. All of it is preferences (hooks/prefs.ts), so every device follows.
import { GripVertical, Monitor, Pencil, Plus, Pilcrow, Smartphone, Sparkles } from "lucide-react";
import { useState, type FormEvent } from "react";
import { TOOL_ICON } from "@/components/format-tool-icons";
import { BUILTIN_ICON, PROMPT_ICON } from "@/components/note-action-icons";
import { Choice } from "@/components/settings/choice";
import { SUB, TITLE } from "@/components/settings/style";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  FORMAT_TOOL_LABEL, NARROW_BAR, placesFor, SELECTION_TOOL_LABEL, TOOL_PLACE_LABEL, type SelectionSlot, type SelectionTool, type ToolSlot,
} from "@/core/format-tools";
import {
  ACTION_ICONS, BUILTIN_LABEL, isBuiltin, ACTION_LIMITS, movedSlot, newActionId, SLOT_PLACE_LABEL, SLOT_PLACES, placedAt, promptProblem,
  RESULT_ABOUT, RESULT_LABEL, RESULTS, type ActionIcon, type PromptAction, type Result, type Slot,
} from "@/core/note-actions";
import type { Layout } from "@/core/prefs";
import { useRowDrag } from "@/hooks/drag";
import { useLayout } from "@/hooks/media";
import { prefsNow, setPrefs, usePrefs } from "@/hooks/prefs";
import { cn } from "@/lib/utils";

const setHeader = (layout: Layout, noteHeader: Slot[]) =>
  setPrefs(layout === "phone" ? { phone: { noteHeader } } : { desktop: { noteHeader } });
const setTools = (layout: Layout, formatTools: ToolSlot[]) =>
  setPrefs(layout === "phone" ? { phone: { formatTools } } : { desktop: { formatTools } });

/** One layout's format tools: every one, dragged into order, each in the bar, under its ⋯ (the desktop's), or off. */
function ToolList({ layout }: { layout: Layout }) {
  const slots = usePrefs()[layout].formatTools, group = `${layout}-tools`;
  const drag = useRowDrag((_g, id, over, after) => setTools(layout, movedSlot(prefsNow()[layout].formatTools, id, over, after)));
  return (
    <div className="divide-y divide-line rounded-xl border border-line">
      <div className="px-3 py-2.5">
        <p className="text-sm font-semibold">Format tools</p>
        <p className="text-[13px] leading-snug text-dim">
          {layout === "phone"
            ? "Drag to reorder. They ride on top of the keyboard while you write; the tools for moving a list item or editing a table join where they apply."
            : `Drag to reorder. They sit at the left of the note's top bar. When it is narrow, the first ${NARROW_BAR} stay and the rest move under ⋯; Link always stays.`}
        </p>
      </div>
      <ul aria-label={`Format tools, ${layout === "phone" ? "Phone" : "Web"}`} className="divide-y divide-line">
        {slots.map(({ id, place }) => {
          const Icon = TOOL_ICON[id], name = FORMAT_TOOL_LABEL[id], d = drag(group, id);
          return (
            <li key={id} {...d.props} className={cn("relative select-none", d.dragging && "opacity-40")}>
              {d.mark ? <span aria-hidden className={cn("pointer-events-none absolute inset-x-3 h-0.5 rounded-full bg-brand", d.mark === "before" ? "-top-px" : "-bottom-px")} /> : null}
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 px-3 py-2">
                <GripVertical className="size-4 shrink-0 cursor-grab text-faint" aria-hidden />
                <Icon className={cn("size-4 shrink-0", place === "off" ? "text-faint" : "text-dim")} />
                <span className={cn("min-w-0 flex-1 basis-32 truncate text-sm", place === "off" && "text-faint")}>{name}</span>
                <Choice label={`Where ${name} sits`} value={place} options={placesFor(layout, id)} names={TOOL_PLACE_LABEL}
                  onPick={(v) => setTools(layout, placedAt(prefsNow()[layout].formatTools, id, v))} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const setSelection = (selectionBar: SelectionSlot[]) => setPrefs({ desktop: { selectionBar } });
const SELECTION_ICON = (id: SelectionTool) => (id === "style" ? Pilcrow : id === "ask" ? Sparkles : TOOL_ICON[id]);

/** The desktop's bar over selected words: every tool it can have, dragged into order, each shown or not. */
function SelectionList() {
  const slots = usePrefs().desktop.selectionBar;
  const drag = useRowDrag((_g, id, over, after) => setSelection(movedSlot(prefsNow().desktop.selectionBar, id, over, after)));
  return (
    <div className="divide-y divide-line rounded-xl border border-line">
      <div className="px-3 py-2.5">
        <p className="text-sm font-semibold">Selection bar</p>
        <p className="text-[13px] leading-snug text-dim">
          The bar that floats over words you select. Drag to reorder, switch on what it shows. On a phone it is the assistant's button alone.
        </p>
      </div>
      <ul aria-label="Selection bar tools" className="divide-y divide-line">
        {slots.map(({ id, on }) => {
          const Icon = SELECTION_ICON(id), name = SELECTION_TOOL_LABEL[id], d = drag("selection", id);
          return (
            <li key={id} {...d.props} className={cn("relative select-none", d.dragging && "opacity-40")}>
              {d.mark ? <span aria-hidden className={cn("pointer-events-none absolute inset-x-3 h-0.5 rounded-full bg-brand", d.mark === "before" ? "-top-px" : "-bottom-px")} /> : null}
              <div className="flex items-center gap-2.5 px-3 py-2">
                <GripVertical className="size-4 shrink-0 cursor-grab text-faint" aria-hidden />
                <Icon className={cn("size-4 shrink-0", !on ? "text-faint" : id === "ask" ? "text-brand" : "text-dim")} />
                <span className={cn("min-w-0 flex-1 truncate text-sm", !on && "text-faint")}>{name}</span>
                <Switch aria-label={`Show ${name}`} checked={on}
                  onCheckedChange={(v) => setSelection(prefsNow().desktop.selectionBar.map((s) => (s.id === id ? { ...s, on: v } : s)))} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** One layout's note header: every action, dragged into order, each a header button, a menu row, or off. */
function HeaderList({ layout }: { layout: Layout }) {
  const prefs = usePrefs(), slots = prefs[layout].noteHeader, prompts = prefs.noteActions;
  const drag = useRowDrag((_g, id, over, after) => setHeader(layout, movedSlot(prefsNow()[layout].noteHeader, id, over, after)));
  return (
    <div className="divide-y divide-line rounded-xl border border-line">
      <div className="px-3 py-2.5">
        <p className="text-sm font-semibold">Buttons and menu</p>
        <p className="text-[13px] leading-snug text-dim">
          Drag to reorder. Pin as many buttons as you like; the mic and the menu always stay, and the colour and Delete are always in the menu.
        </p>
      </div>
      <ul aria-label={`Note actions, ${layout === "phone" ? "Phone" : "Web"}`} className="divide-y divide-line">
        {slots.map(({ id, place }) => {
          const prompt = prompts.find((p) => p.id === id);
          const Icon = isBuiltin(id) ? BUILTIN_ICON[id] : prompt ? PROMPT_ICON[prompt.icon] : null, name = isBuiltin(id) ? BUILTIN_LABEL[id] : prompt?.label;
          if (!Icon || !name) return null;
          const d = drag(layout, id);
          return (
            <li key={id} {...d.props} className={cn("relative select-none", d.dragging && "opacity-40")}>
              {d.mark ? <span aria-hidden className={cn("pointer-events-none absolute inset-x-3 h-0.5 rounded-full bg-brand", d.mark === "before" ? "-top-px" : "-bottom-px")} /> : null}
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 px-3 py-2">
                <GripVertical className="size-4 shrink-0 cursor-grab text-faint" aria-hidden />
                <Icon className={cn("size-4 shrink-0", place === "off" ? "text-faint" : prompt ? "text-brand" : "text-dim")} />
                <span className={cn("min-w-0 flex-1 basis-32 truncate text-sm", place === "off" && "text-faint")}>{name}</span>
                <Choice label={`Where ${name} sits`} value={place} options={SLOT_PLACES} names={SLOT_PLACE_LABEL}
                  onPick={(v) => setHeader(layout, placedAt(prefsNow()[layout].noteHeader, id, v))} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** An assistant action's form: a new one, or `action` changed. */
function ActionDialog({ action, onClose }: { action: PromptAction | null; onClose: () => void }) {
  const [label, setLabel] = useState(action?.label ?? ""), [prompt, setPrompt] = useState(action?.prompt ?? "");
  const [result, setResult] = useState<Result>(action?.result ?? "edit"), [icon, setIcon] = useState<ActionIcon>(action?.icon ?? "sparkles");
  const [tried, setTried] = useState(false);
  const problem = promptProblem({ label, prompt });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (problem) return;
    const all = prefsNow().noteActions;
    const next: PromptAction = { id: action?.id ?? newActionId(label, all.map((a) => a.id)), label: label.trim(), prompt: prompt.trim(), result, icon };
    setPrefs({ noteActions: action ? all.map((a) => (a.id === action.id ? next : a)) : [...all, next] });
    onClose();
  };
  const remove = () => {
    if (!action) return;
    setPrefs({ noteActions: prefsNow().noteActions.filter((a) => a.id !== action.id) });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        <form onSubmit={submit} className="min-w-0 space-y-4">
          <DialogHeader>
            <DialogTitle>{action ? "Edit action" : "New action"}</DialogTitle>
            <DialogDescription>A prompt the assistant runs on the open note when you press its button.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="action-name">Name</Label>
            <Input id="action-name" autoFocus value={label} maxLength={ACTION_LIMITS.label} onChange={(e) => setLabel(e.target.value)} placeholder="Summarise" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="action-prompt">Prompt</Label>
            <Textarea id="action-prompt" value={prompt} maxLength={ACTION_LIMITS.prompt} onChange={(e) => setPrompt(e.target.value)} rows={5}
              placeholder="Add a three-line summary at the top of this note. Invent nothing." />
          </div>
          <div className="space-y-1.5">
            <Label>What it does</Label>
            <Choice label="What it does" value={result} options={RESULTS} names={RESULT_LABEL} onPick={setResult} />
            <p className="text-[13px] leading-snug text-dim">{RESULT_ABOUT[result]}.</p>
          </div>
          <div className="space-y-1.5">
            <Label>Icon</Label>
            <div role="radiogroup" aria-label="Icon" className="flex flex-wrap gap-1.5">
              {ACTION_ICONS.map((i) => {
                const Icon = PROMPT_ICON[i];
                return (
                  <button key={i} type="button" role="radio" aria-checked={icon === i} aria-label={i} onClick={() => setIcon(i)}
                    className={cn("grid size-9 place-items-center rounded-lg border outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      icon === i ? "border-brand bg-brand/10 text-brand" : "border-line text-dim hover:bg-muted")}>
                    <Icon className="size-4" />
                  </button>
                );
              })}
            </div>
          </div>
          {tried && problem ? <p role="alert" className="text-xs text-down">{problem}</p> : null}
          <DialogFooter>
            {action ? <Button type="button" variant="ghost" className="mr-auto rounded-full text-down" onClick={remove}>Delete</Button> : null}
            <Button type="button" variant="outline" className="rounded-full" onClick={onClose}>Cancel</Button>
            <Button type="submit" className="rounded-full">{action ? "Save" : "Add action"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The assistant actions: the owner's saved prompts. */
function Actions() {
  const actions = usePrefs().noteActions;
  const [editing, setEditing] = useState<PromptAction | "new" | null>(null);
  return (
    <section className="space-y-3" aria-labelledby="note-actions-h">
      <div className="flex items-center gap-3">
        <h3 id="note-actions-h" className={cn(SUB, "min-w-0 flex-1")}>Assistant actions</h3>
        <Button size="sm" variant="outline" className="rounded-full" disabled={actions.length >= ACTION_LIMITS.actions} onClick={() => setEditing("new")}><Plus />New action</Button>
      </div>
      <p className="text-sm text-dim">A saved prompt, run on the open note from its button. What it writes still follows “What the agent may do”. You can also ask the assistant to make one.</p>
      {actions.length ? (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {actions.map((a) => {
            const Icon = PROMPT_ICON[a.icon];
            return (
              <li key={a.id}>
                <button type="button" onClick={() => setEditing(a)}
                  className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
                  <Icon className="size-4 shrink-0 text-brand" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{a.label}</span>
                    <span className="block truncate text-[13px] text-dim">{a.prompt}</span>
                  </span>
                  <span className="shrink-0 rounded-md border border-line px-1.5 py-0.5 text-[11px] text-dim">{RESULT_LABEL[a.result]}</span>
                  <Pencil className="size-4 shrink-0 text-faint" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : <p className="rounded-xl border border-line px-3 py-4 text-sm text-faint">None yet.</p>}
      {editing ? <ActionDialog key={editing === "new" ? "new" : editing.id} action={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
    </section>
  );
}

export function NotesSettings() {
  const here = useLayout();
  return (
    <div className="space-y-8">
      <section className="space-y-3" aria-labelledby="notes-h">
        <h2 id="notes-h" className={TITLE}>Notes</h2>
        <h3 className={SUB}>Note bar</h3>
        <Tabs defaultValue={here} className="space-y-3">
          <TabsList>
            <TabsTrigger value="phone"><Smartphone /> Phone</TabsTrigger>
            <TabsTrigger value="desktop"><Monitor /> Web</TabsTrigger>
          </TabsList>
          <TabsContent value="phone" className="space-y-3"><ToolList layout="phone" /><HeaderList layout="phone" /></TabsContent>
          <TabsContent value="desktop" className="space-y-3"><ToolList layout="desktop" /><SelectionList /><HeaderList layout="desktop" /></TabsContent>
        </Tabs>
      </section>
      <Actions />
    </div>
  );
}
