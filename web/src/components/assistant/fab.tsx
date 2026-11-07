// The assistant's button while the dock is closed: one round button at the corner that opens it.
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAssistant } from "@/hooks/assistant";

export function AssistantFab() {
  const assistant = useAssistant();
  return (
    <Button size="icon-lg" aria-label="Open the assistant" title="Assistant" onClick={() => assistant.show()}
      className="fixed right-5 bottom-5 z-30 size-14 rounded-full shadow-lg">
      <Sparkles className="size-6" />
    </Button>
  );
}
