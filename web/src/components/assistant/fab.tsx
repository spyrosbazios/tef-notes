// The assistant's button while the dock and Talk's panel are closed: one round glass button (hooks/glass.ts) at the corner, the page
// scrolling on under it. What it opens is the owner's `desktop.fab` (core/prefs.ts): the chat, Talk in its small panel there
// (talk/panel.tsx, a conversation started unless one is on), or a menu of the two. Not on a phone: Ask is a tab there.
import { AudioLines, MessageSquare, Sparkles } from "lucide-react";
import { LiquidGlass } from "quick-liquid/react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAssistant } from "@/hooks/assistant";
import { useGlass } from "@/hooks/glass";
import { usePrefs } from "@/hooks/prefs";
import { useTalk, useTalkOn } from "@/hooks/talk";
import { haptic } from "@/lib/haptics";
import { setTalkPanel } from "@/lib/talk-panel";

const PLACE = "fixed max-md:hidden right-[max(1.25rem,env(safe-area-inset-right))] bottom-[max(1.25rem,env(safe-area-inset-bottom))] z-30 size-14 rounded-full [&>.ql-content]:size-full";
const BUTTON = "size-full rounded-full text-brand";

export function AssistantFab() {
  const assistant = useAssistant();
  const glass = useGlass({ material: "thin" });
  const { phase, session } = useTalk();
  const talkOn = useTalkOn(), chosen = usePrefs().desktop.fab;
  const fab = talkOn ? chosen : "chat";
  const talk = () => {
    haptic("start");
    setTalkPanel(true);
    if (phase !== "connecting" && phase !== "live") session.start();
  };
  return (
    <LiquidGlass config={glass} className={PLACE}>
      {fab === "menu" ? <FabMenu onChat={() => assistant.show()} onTalk={talk} /> : (
        <Button variant="ghost" size="icon-lg" aria-label={fab === "talk" ? "Talk to the assistant" : "Open the assistant"} title={fab === "talk" ? "Talk" : "Assistant"}
          onClick={fab === "talk" ? talk : () => assistant.show()} className={BUTTON}>
          {fab === "talk" ? <AudioLines className="size-6" /> : <Sparkles className="size-6" />}
        </Button>
      )}
    </LiquidGlass>
  );
}

function FabMenu({ onChat, onTalk }: { onChat: () => void; onTalk: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-lg" aria-label="Ask the assistant" title="Assistant" className={BUTTON}>
          <Sparkles className="size-6" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" sideOffset={10} className="w-48">
        <DropdownMenuItem onSelect={onChat}><MessageSquare /> Type</DropdownMenuItem>
        <DropdownMenuItem onSelect={onTalk}><AudioLines /> Talk</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
