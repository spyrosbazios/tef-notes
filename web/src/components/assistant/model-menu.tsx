// Which model the agent runs on (the server's provider's models as it lists them) and how hard it works (@/core/agent
// EFFORT). Both are this browser's (hooks/agent.ts); the next message goes out with them.
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cap, EFFORT, EFFORTS, effortOf } from "@/core/agent";
import { useModel } from "@/hooks/agent";

/** A model id as the pill shows it: its last path segment (`org/model` lists) */
const shortId = (id: string) => id.split("/").at(-1) ?? id;

/** The pill reads the model and the effort, as the message field's own control. `align`: the menu's edge against the pill. */
export function ModelMenu({ disabled, align = "start" }: { disabled?: boolean; align?: "start" | "end" }) {
  const { model, models, effort, set } = useModel();
  const listed = models?.models ?? [];
  const ids = model && !listed.includes(model) ? [model, ...listed] : listed;   // a saved id the list no longer has
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" disabled={disabled || !model} aria-label={model ? `Model: ${model}, ${effort} effort. Change` : "No model"} title={model ? `${model} · ${effort}` : "No model"} className="h-8 min-w-0 shrink gap-1.5 rounded-full px-2.5 text-[13px] font-medium text-dim">
          <span className="min-w-0 truncate">{model ? shortId(model) : "No model"}</span>
          <span className="shrink-0 font-normal text-faint">{cap(effort)}</span>
          <ChevronDown className="size-3 shrink-0 text-faint" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="max-h-96 min-w-64 overflow-y-auto">
        <DropdownMenuLabel className="text-xs text-faint">Effort</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={effort} onValueChange={(v) => set({ effort: effortOf(v) })}>
          {EFFORTS.map((e) => (
            <DropdownMenuRadioItem key={e} value={e} onSelect={(ev) => ev.preventDefault()}>
              <span className="flex flex-col"><span>{cap(e)}</span><span className="text-xs text-faint">{EFFORT[e].about}</span></span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-faint">Model</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={model ?? ""} onValueChange={(id) => set({ model: id })}>
          {ids.map((id) => (
            <DropdownMenuRadioItem key={id} value={id} className="font-mono text-xs">
              {id}{id === models?.default ? <span className="ml-1 font-sans text-faint">default</span> : null}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
