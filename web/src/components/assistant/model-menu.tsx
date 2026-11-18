// Which model the agent runs on (the server's provider's models as it lists them) and how hard it works (@/core/agent
// EFFORT): Ask's choice, or Talk's (hooks/agent.ts `ModelChoice`), which can also follow Ask's.
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cap, EFFORT, EFFORTS, effortOf } from "@/core/agent";
import type { ModelChoice } from "@/hooks/agent";
import { cn } from "@/lib/utils";

/** A model id as the pill shows it: its last path segment (`org/model` lists) */
const shortId = (id: string) => id.split("/").at(-1) ?? id;

/** The pill reads the model and the effort, as the message field's own control. `align`: the menu's edge against the pill. `compact`: below `md`
 *  the pill is a lone icon (the name and effort stay in its title and the menu), for a header with no room for them. */
export function ModelMenu({ choice, disabled, align = "start", compact }: { choice: ModelChoice; disabled?: boolean; align?: "start" | "end"; compact?: boolean }) {
  const { model, models, effort, set, follows } = choice;
  const listed = models?.models ?? [];
  const ids = model && !listed.includes(model) ? [model, ...listed] : listed;   // a saved id the list no longer has
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" disabled={disabled || !model} aria-label={model ? `Model: ${model}, ${effort} effort. Change` : "No model"} title={model ? `${model} · ${effort}` : "No model"} className={cn("h-8 min-w-0 shrink gap-1.5 rounded-full px-2.5 text-[13px] font-medium text-dim", compact && "max-md:size-8 max-md:px-0")}>
          {compact ? <SlidersHorizontal className="size-4 md:hidden" /> : null}
          <span className={cn("min-w-0 truncate", compact && "max-md:hidden")}>{model ? shortId(model) : "No model"}</span>
          <span className={cn("shrink-0 font-normal text-faint", compact && "max-md:hidden")}>{cap(effort)}</span>
          <ChevronDown className={cn("size-3 shrink-0 text-faint", compact && "max-md:hidden")} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="max-h-96 min-w-64 overflow-y-auto">
        {follows !== undefined ? (
          <>
            <DropdownMenuCheckboxItem checked={follows} disabled={follows} onCheckedChange={() => set({ follow: true })}>
              <span className="flex flex-col"><span>Same as Ask</span><span className="text-xs text-faint">Follow the assistant's model and effort</span></span>
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
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
