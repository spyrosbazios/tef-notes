// The assistant's button while the dock is closed: one round glass button (hooks/glass.ts) at the corner that opens it, the page
// scrolling on under it. Not on a phone: Ask is a tab there.
import { Sparkles } from "lucide-react";
import { LiquidGlass } from "quick-liquid/react";
import { Button } from "@/components/ui/button";
import { useAssistant } from "@/hooks/assistant";
import { useGlass } from "@/hooks/glass";

export function AssistantFab() {
  const assistant = useAssistant();
  const glass = useGlass({ material: "thin" });
  return (
    <LiquidGlass config={glass} className="fixed max-md:hidden right-[max(1.25rem,env(safe-area-inset-right))] bottom-[max(1.25rem,env(safe-area-inset-bottom))] z-30 size-14 rounded-full [&>.ql-content]:size-full">
      <Button variant="ghost" size="icon-lg" aria-label="Open the assistant" title="Assistant" onClick={() => assistant.show()} className="size-full rounded-full text-brand">
        <Sparkles className="size-6" />
      </Button>
    </LiquidGlass>
  );
}
