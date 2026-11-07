// Which model the agent runs on: the server's provider's models as it lists them. The choice is this browser's
// (hooks/agent.ts); the next message goes to the new model.
import { ChevronDown, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useModel } from "@/hooks/agent";

export function ModelMenu({ disabled }: { disabled?: boolean }) {
  const { model, models, set } = useModel();
  const listed = models?.models ?? [];
  const ids = model && !listed.includes(model) ? [model, ...listed] : listed;   // a saved id the list no longer has
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" disabled={disabled || !model} aria-label={model ? `Model: ${model}. Change` : "No model"} title={model ?? "No model"} className="shrink-0 px-2 text-faint">
          <Settings2 /> <ChevronDown className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-96 min-w-64 overflow-y-auto">
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
