// Settings → Agent: the model and effort, which of its writes ask first, and what it remembers of the owner.
import { useQuery } from "@tanstack/react-query";
import { Bot, Brain, FilePen, FilePlus, FileX, ListPlus, ListTodo, ListX, MousePointerClick, Paperclip, ShieldAlert, Tag as TagIcon, type LucideIcon } from "lucide-react";
import { ACTION_LABEL, ACTIONS, RULE_LABEL, RULES, type Action } from "@/core/actions";
import { NEW_CHAT_LABEL, NEW_CHATS } from "@/core/prefs";
import { ModelMenu } from "@/components/assistant/model-menu";
import { Empty } from "@/components/empty";
import { Loaded } from "@/components/loaded";
import { Markdown } from "@/components/markdown";
import { Choice } from "@/components/settings/choice";
import { SUB, TITLE } from "@/components/settings/style";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useModel } from "@/hooks/agent";
import { setPrefs, usePrefs } from "@/hooks/prefs";
import { memory } from "@/services/notes";

export function Agent() {
  const choice = useModel(), { models, newChat, set } = choice;
  return (
    <div className="space-y-8">
      <section className="space-y-3" aria-labelledby="agent-h">
      <h2 id="agent-h" className={TITLE}>Agent</h2>
      <div className="divide-y divide-line rounded-xl border border-line">
        <div className="flex items-center gap-3 px-3 py-2.5">
          <div className="min-w-0 flex-1"><p className="text-sm font-semibold">Model and effort</p></div>
          <ModelMenu choice={choice} align="end" />
        </div>
        <div className="space-y-2.5 px-3 py-2.5">
          <div>
            <p className="text-sm font-semibold">Start a new chat</p>
            <p className="text-[13px] leading-snug text-dim">When opening the assistant clears the last chat.</p>
          </div>
          <Choice label="Start a new chat" value={newChat} options={NEW_CHATS} names={NEW_CHAT_LABEL} onPick={(v) => set({ newChat: v })} />
        </div>
        {models ? (
          <div className="px-3 py-2.5">
            <p className="text-sm font-semibold">Web</p>
            <p className="text-[13px] leading-snug text-dim">{models.web ? "The agent can search the web and read pages." : "Web search is off: the server has no search key."}</p>
          </div>
        ) : null}
      </div>
    </section>
    <AgentActions />
    <Memory />
    </div>
  );
}

const ACTION_ICON: Record<Action, LucideIcon> = {
  createTask: ListPlus, editTask: ListTodo, deleteTask: ListX, createNote: FilePlus, editNote: FilePen, deleteNote: FileX,
  files: Paperclip, tags: TagIcon, noteActions: MousePointerClick, memory: Brain,
};

/** Which of the agent's writes wait on a card, go ahead, or are never allowed: one rule per action (@/core/actions), kept in the
 *  preferences and enforced by the agent's server, so no reply can skip a card. */
function AgentActions() {
  const { actions, agent: { webGuard } } = usePrefs();
  return (
    <section className="space-y-3" aria-labelledby="actions-h">
      <h3 id="actions-h" className={SUB}>What the agent may do</h3>
      <p className="text-sm text-dim">Ask first waits on a card. Just do it doesn't{webGuard ? ", unless the check below asks" : ""}. Never blocks it.</p>
      <div className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5">
        <ShieldAlert className="size-4 shrink-0 text-dim" aria-hidden />
        <div className="min-w-0 flex-1">
          <Label htmlFor="web-guard" className="text-sm font-semibold">Ask after reading outside text</Label>
          <p className="text-[13px] leading-snug text-dim">After the web, a PDF or an attached file, Just do it asks first: such text can carry instructions.</p>
        </div>
        <Switch id="web-guard" checked={webGuard} onCheckedChange={(v) => setPrefs({ agent: { webGuard: v } })} />
      </div>
      <ul className="divide-y divide-line rounded-xl border border-line">
        {ACTIONS.map((a) => {
          const Icon = ACTION_ICON[a], { name, covers } = ACTION_LABEL[a];
          return (
            <li key={a} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
              <Icon className="size-4 shrink-0 text-dim" aria-hidden />
              <div className="min-w-0 flex-1 basis-40">
                <p className="text-sm font-semibold">{name}</p>
                <p className="text-[13px] leading-snug text-dim">{covers}</p>
              </div>
              <Choice label={name} value={actions[a]} options={RULES} names={RULE_LABEL} onPick={(v) => setPrefs({ actions: { [a]: v } })} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** agent/memory.md: the agent's notes about the owner, which it rewrites itself. Shown, not edited here: it is the agent's record, not a note. */
function Memory() {
  const { data, isPending } = useQuery({ queryKey: ["memory"], queryFn: memory });
  return (
    <section className="space-y-3" aria-labelledby="memory-h">
      <h3 id="memory-h" className={SUB}>Agent memory</h3>
      <div className="rounded-xl border border-line px-3 py-2.5">
        <Loaded loading={isPending} blurred={false} skeleton={<Skeleton className="h-24" />}>
          {data?.text.trim() ? <Markdown body={data.text} /> : <Empty icon={Bot} className="py-2"><p className="text-sm text-faint">Empty: the agent hasn't written anything yet.</p></Empty>}
        </Loaded>
      </div>
    </section>
  );
}
