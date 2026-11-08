// The assistant's button while the dock is closed: one round button at the corner that opens it. Not on a phone: Ask is a tab there.
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAssistant } from "@/hooks/assistant";

export function AssistantFab() {
  const assistant = useAssistant();
  return (
    <Button size="icon-lg" aria-label="Open the assistant" title="Assistant" onClick={() => assistant.show()}
      className="fixed max-md:hidden right-[max(1.25rem,env(safe-area-inset-right))] bottom-[max(1.25rem,env(safe-area-inset-bottom))] z-30 size-14 rounded-full shadow-lg">
      <Sparkles className="size-6" />
    </Button>
  );
}
