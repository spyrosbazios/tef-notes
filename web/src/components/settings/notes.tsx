// Settings → Notes: the assistant actions (the owner's saved prompts, added, changed and deleted here), and per layout the
// editor's format tools (core/format-tools.ts: dragged into order; in the bar, under its ⋯, or off), the desktop's bar over
// selected words (the same file: dragged into order, each shown or not) and where each of a note's actions sits in its header
// (core/note-actions.ts: dragged into order; a button in the header, a row in the menu, or off). All of it is preferences
// (hooks/prefs.ts), so every device follows.
import { EllipsisVertical, EyeOff, FilePen, ListPlus, MessageSquareText, PanelBottom, PanelTop, Pilcrow, Plus, Sparkles, type LucideIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import { TOOL_ICON } from "@/components/format-tool-icons";
import { BUILTIN_ICON, PROMPT_ICON } from "@/components/note-action-icons";
import { LayoutTabs } from "@/components/settings/layout";
import { DragItem, Grip, Group, Legend, Page, Pill, Row, Segmented, type Option } from "@/components/settings/kit";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  FORMAT_TOOL_LABEL, NARROW_BAR, placesFor, SELECTION_TOOL_LABEL, TOOL_PLACE_LABEL, TOOL_PLACES, type SelectionSlot, type SelectionTool, type ToolSlot,
} from "@/core/format-tools";
import {
  ACTION_ICONS, BUILTIN_LABEL, isBuiltin, ACTION_LIMITS, movedSlot, newActionId, SLOT_PLACE_LABEL, SLOT_PLACES, placedAt, promptProblem,
  RESULT_ABOUT, RESULT_LABEL, RESULTS, type ActionIcon, type PromptAction, type Result, type Slot,
} from "@/core/note-actions";
import type { Layout } from "@/core/prefs";
import { useRowDrag } from "@/hooks/drag";
import { prefsNow, setPrefs, usePrefs } from "@/hooks/prefs";
import { cn } from "@/lib/utils";

const setHeader = (layout: Layout, noteHeader: Slot[]) =>
  setPrefs(layout === "phone" ? { phone: { noteHeader } } : { desktop: { noteHeader } });
const setTools = (layout: Layout, formatTools: ToolSlot[]) =>
  setPrefs(layout === "phone" ? { phone: { formatTools } } : { desktop: { formatTools } });

type ToolPlace = (typeof TOOL_PLACES)[number];
type SlotPlace = (typeof SLOT_PLACES)[number];
/** The phone's bar rides on the keyboard, the desktop's tops the note. */
const toolPlaceOf = (layout: Layout) => (p: ToolPlace): Option => ({
  label: TOOL_PLACE_LABEL[p], icon: p === "bar" ? (layout === "phone" ? PanelBottom : PanelTop) : p === "menu" ? EllipsisVertical : EyeOff, tone: p === "bar" ? "brand" : "muted",
});
const slotPlaceOf = (p: SlotPlace): Option => ({ label: SLOT_PLACE_LABEL[p], icon: p === "header" ? PanelTop : p === "menu" ? EllipsisVertical : EyeOff, tone: p === "header" ? "brand" : "muted" });
const RESULT_ICON: Record<Result, LucideIcon> = { edit: FilePen, task: ListPlus, answer: MessageSquareText };
const resultOf = (r: Result): Option => ({ label: RESULT_LABEL[r], icon: RESULT_ICON[r] });

/** One layout's format tools: every one, dragged into order, each in the bar, under its ⋯ (the desktop's), or off. */
function ToolList({ layout }: { layout: Layout }) {
  const slots = usePrefs()[layout].formatTools, group = `${layout}-tools`, placeOf = toolPlaceOf(layout);
  const drag = useRowDrag((_g, id, over, after) => setTools(layout, movedSlot(prefsNow()[layout].formatTools, id, over, after)));
  const places = layout === "phone" ? placesFor("phone", "bold") : TOOL_PLACES;
  return (
    <Group title="Format tools" action={<Legend options={places} of={placeOf} />}
      hint={layout === "phone" ? "Drag to reorder. The bar rides on the keyboard." : `Drag to reorder. In a narrow window the first ${NARROW_BAR} stay; Link always does.`}>
      <ul aria-label={`Format tools, ${layout === "phone" ? "Phone" : "Web"}`} className="divide-y divide-line">
        {slots.map(({ id, place }) => {
          const name = FORMAT_TOOL_LABEL[id];
          return (
            <DragItem key={id} drag={drag(group, id)}>
              <Row lead={<Grip />} icon={TOOL_ICON[id]} off={place === "off"} title={name}>
                <Segmented compact label={`Where ${name} sits`} value={place} options={placesFor(layout, id)} of={placeOf}
                  onPick={(v) => setTools(layout, placedAt(prefsNow()[layout].formatTools, id, v))} />
              </Row>
            </DragItem>
          );
        })}
      </ul>
    </Group>
  );
}

const setSelection = (selectionBar: SelectionSlot[]) => setPrefs({ desktop: { selectionBar } });
const SELECTION_ICON = (id: SelectionTool) => (id === "style" ? Pilcrow : id === "ask" ? Sparkles : TOOL_ICON[id]);

/** The desktop's bar over selected words: every tool it can have, dragged into order, each shown or not. */
function SelectionList() {
  const slots = usePrefs().desktop.selectionBar;
  const drag = useRowDrag((_g, id, over, after) => setSelection(movedSlot(prefsNow().desktop.selectionBar, id, over, after)));
  return (
    <Group title="Selection bar" hint="Floats over selected words. Drag to reorder.">
      <ul aria-label="Selection bar tools" className="divide-y divide-line">
        {slots.map(({ id, on }) => {
          const name = SELECTION_TOOL_LABEL[id];
          return (
            <DragItem key={id} drag={drag("selection", id)}>
              <Row lead={<Grip />} icon={SELECTION_ICON(id)} tone={id === "ask" ? "brand" : "dim"} off={!on} title={name}>
                <Switch aria-label={`Show ${name}`} checked={on}
                  onCheckedChange={(v) => setSelection(prefsNow().desktop.selectionBar.map((s) => (s.id === id ? { ...s, on: v } : s)))} />
              </Row>
            </DragItem>
          );
        })}
      </ul>
    </Group>
  );
}

/** One layout's note header: every action, dragged into order, each a header button, a menu row, or off. */
function HeaderList({ layout }: { layout: Layout }) {
  const prefs = usePrefs(), slots = prefs[layout].noteHeader, prompts = prefs.noteActions;
  const drag = useRowDrag((_g, id, over, after) => setHeader(layout, movedSlot(prefsNow()[layout].noteHeader, id, over, after)));
  return (
    <Group title="Note header" action={<Legend options={SLOT_PLACES} of={slotPlaceOf} />}
      hint="Drag to reorder. The mic and the menu always stay; colour and Delete live in the menu.">
      <ul aria-label={`Note actions, ${layout === "phone" ? "Phone" : "Web"}`} className="divide-y divide-line">
        {slots.map(({ id, place }) => {
          const prompt = prompts.find((p) => p.id === id);
          const icon = isBuiltin(id) ? BUILTIN_ICON[id] : prompt ? PROMPT_ICON[prompt.icon] : null, name = isBuiltin(id) ? BUILTIN_LABEL[id] : prompt?.label;
          if (!icon || !name) return null;
          return (
            <DragItem key={id} drag={drag(layout, id)}>
              <Row lead={<Grip />} icon={icon} tone={prompt ? "brand" : "dim"} off={place === "off"} title={name}>
                <Segmented compact label={`Where ${name} sits`} value={place} options={SLOT_PLACES} of={slotPlaceOf}
                  onPick={(v) => setHeader(layout, placedAt(prefsNow()[layout].noteHeader, id, v))} />
              </Row>
            </DragItem>
          );
        })}
      </ul>
    </Group>
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
            <DialogDescription>A prompt the assistant runs on the open note.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Icon and name</Label>
            <div role="radiogroup" aria-label="Icon" className="flex flex-wrap gap-1.5">
              {ACTION_ICONS.map((i) => {
                const Icon = PROMPT_ICON[i];
                return (
                  <button key={i} type="button" role="radio" aria-checked={icon === i} aria-label={i} onClick={() => setIcon(i)}
                    className={cn("grid size-8 place-items-center rounded-lg border outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      icon === i ? "border-brand bg-brand/15 text-brand" : "border-line text-dim hover:bg-muted")}>
                    <Icon className="size-4" />
                  </button>
                );
              })}
            </div>
            <Input id="action-name" aria-label="Name" autoFocus value={label} maxLength={ACTION_LIMITS.label} onChange={(e) => setLabel(e.target.value)} placeholder="Summarise" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="action-prompt">Prompt</Label>
            <Textarea id="action-prompt" value={prompt} maxLength={ACTION_LIMITS.prompt} onChange={(e) => setPrompt(e.target.value)} rows={5}
              placeholder="Add a three-line summary at the top of this note. Invent nothing." />
          </div>
          <div className="space-y-1.5">
            <Label>Result</Label>
            <Segmented label="Result" value={result} options={RESULTS} of={resultOf} onPick={setResult} />
            <p className="text-xs leading-snug text-dim">{RESULT_ABOUT[result]}.</p>
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

/** The assistant actions: the owner's saved prompts, each opened to change it. */
function Actions() {
  const actions = usePrefs().noteActions;
  const [editing, setEditing] = useState<PromptAction | "new" | null>(null);
  return (
    <>
      <Group title="Assistant actions" hint="Their writes follow Agent → Permissions."
        action={<Button size="sm" variant="ghost" className="h-7 rounded-full text-brand" disabled={actions.length >= ACTION_LIMITS.actions} onClick={() => setEditing("new")}><Plus />New</Button>}>
        {actions.length ? (
          <ul className="divide-y divide-line">
            {actions.map((a) => {
              const Result = RESULT_ICON[a.result];
              return (
                <li key={a.id}>
                  <button type="button" onClick={() => setEditing(a)} className="block w-full text-left outline-none hover:bg-muted focus-visible:bg-muted">
                    <Row icon={PROMPT_ICON[a.icon]} tone="brand" title={a.label} detail={<span className="line-clamp-1">{a.prompt}</span>}>
                      <Pill><Result />{RESULT_LABEL[a.result]}</Pill>
                    </Row>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : <p className="px-3 py-4 text-sm text-faint">None yet.</p>}
      </Group>
      {editing ? <ActionDialog key={editing === "new" ? "new" : editing.id} action={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

export function NotesSettings() {
  return (
    <Page title="Notes">
      <Actions />
      <LayoutTabs
        phone={<><ToolList layout="phone" /><HeaderList layout="phone" /></>}
        desktop={<><ToolList layout="desktop" /><SelectionList /><HeaderList layout="desktop" /></>} />
    </Page>
  );
}
