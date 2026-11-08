// Which model the agent runs on (the server's provider's models as it lists them) and how hard it works (@/core/agent
// EFFORT). Both are this browser's (hooks/agent.ts); the next message goes out with them.
import { ChevronDown, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cap, EFFORT, EFFORTS, effortOf } from "@/core/agent";
import { useModel } from "@/hooks/agent";

export function ModelMenu({ disabled }: { disabled?: boolean }) {
  const { model, models, effort, set } = useModel();
  const listed = models?.models ?? [];
  const ids = model && !listed.includes(model) ? [model, ...listed] : listed;   // a saved id the list no longer has
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" disabled={disabled || !model} aria-label={model ? `Model: ${model}, ${effort} effort. Change` : "No model"} title={model ? `${model} · ${effort}` : "No model"} className="shrink-0 px-2 text-faint">
          <Settings2 /> <ChevronDown className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-96 min-w-64 overflow-y-auto">
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
