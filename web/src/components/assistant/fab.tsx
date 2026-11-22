// The assistant's button while the dock is closed: one round glass button (hooks/glass.ts) at the corner, the page scrolling on
// under it. It opens the chat, or (the owner's `desktop.fab`, core/prefs.ts) a small menu: type in the chat, or talk (Talk starts
// where the owner is, its pill showing; while one is on, the item goes back to it). Not on a phone: Ask is a tab there.
import { AudioLines, MessageSquare, Sparkles } from "lucide-react";
import { LiquidGlass } from "quick-liquid/react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAssistant } from "@/hooks/assistant";
import { useGlass } from "@/hooks/glass";
import { usePrefs } from "@/hooks/prefs";
import { useTalk, useTalkOn } from "@/hooks/talk";
import { haptic } from "@/lib/haptics";
import { useNav } from "@/lib/nav";

const PLACE = "fixed max-md:hidden right-[max(1.25rem,env(safe-area-inset-right))] bottom-[max(1.25rem,env(safe-area-inset-bottom))] z-30 size-14 rounded-full [&>.ql-content]:size-full";
const BUTTON = "size-full rounded-full text-brand";

export function AssistantFab() {
  const assistant = useAssistant();
  const glass = useGlass({ material: "thin" });
  const talkOn = useTalkOn(), menu = usePrefs().desktop.fab === "menu" && talkOn;
  return (
    <LiquidGlass config={glass} className={PLACE}>
      {menu ? <FabMenu onChat={() => assistant.show()} /> : (
        <Button variant="ghost" size="icon-lg" aria-label="Open the assistant" title="Assistant" onClick={() => assistant.show()} className={BUTTON}>
          <Sparkles className="size-6" />
        </Button>
      )}
    </LiquidGlass>
  );
}

function FabMenu({ onChat }: { onChat: () => void }) {
  const { phase, session } = useTalk();
  const { goView } = useNav();
  const live = phase === "connecting" || phase === "live";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-lg" aria-label="Ask the assistant" title="Assistant" className={BUTTON}>
          <Sparkles className="size-6" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" sideOffset={10} className="w-48">
        <DropdownMenuItem onSelect={onChat}><MessageSquare /> Type</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => { haptic("start"); if (live) goView({ kind: "talk" }); else session.start(); }}>
          <AudioLines /> {live ? "Back to Talk" : "Talk"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
