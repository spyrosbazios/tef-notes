// Settings → Agent: the model and effort, when a chat starts afresh, which of its writes ask first, and what it remembers of the owner.
import { useQuery } from "@tanstack/react-query";
import { Ban, Bot, Brain, Cpu, FilePen, FilePlus, FileX, Globe, Hand, ListPlus, ListTodo, ListX, MessageSquarePlus, MousePointerClick, Paperclip, ShieldAlert, Tag as TagIcon, Zap, type LucideIcon } from "lucide-react";
import { ACTION_LABEL, ACTIONS, RULE_LABEL, RULES, type Action } from "@/core/actions";
import { NEW_CHAT_LABEL, NEW_CHATS } from "@/core/prefs";
import { ModelMenu } from "@/components/assistant/model-menu";
import { Empty } from "@/components/empty";
import { Loaded } from "@/components/loaded";
import { Markdown } from "@/components/markdown";
import { Choose, Group, Legend, Page, Row, Segmented, Status, type Option } from "@/components/settings/kit";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useModel } from "@/hooks/agent";
import { setPrefs, usePrefs } from "@/hooks/prefs";
import { memory } from "@/services/notes";

export function Agent() {
  const choice = useModel(), { models, newChat, set } = choice;
  return (
    <Page title="Agent">
      <Group title="Chat">
        <Row icon={Cpu} title="Model and effort"><ModelMenu choice={choice} align="end" /></Row>
        <Row icon={MessageSquarePlus} title="New chat">
          <Choose label="Start a new chat" value={newChat} options={NEW_CHATS} of={(v) => ({ label: NEW_CHAT_LABEL[v] })} onPick={(v) => set({ newChat: v })} />
        </Row>
        {models ? (
          <Row icon={Globe} title="Web search" detail={models.web ? undefined : "The server has no search key."}>
            <Status tone={models.web ? "up" : "muted"}>{models.web ? "On" : "Off"}</Status>
          </Row>
        ) : null}
      </Group>
      <AgentActions />
      <Memory />
    </Page>
  );
}

type Rule = (typeof RULES)[number];

const ACTION_ICON: Record<Action, LucideIcon> = {
  createTask: ListPlus, editTask: ListTodo, deleteTask: ListX, createNote: FilePlus, editNote: FilePen, deleteNote: FileX,
  files: Paperclip, tags: TagIcon, noteActions: MousePointerClick, memory: Brain,
};
const RULE: Record<Rule, Option> = {
  ask: { label: RULE_LABEL.ask, icon: Hand, tone: "warn" },
  auto: { label: RULE_LABEL.auto, icon: Zap, tone: "up" },
  never: { label: RULE_LABEL.never, icon: Ban, tone: "down" },
};
const ruleOf = (r: Rule) => RULE[r];

/** Which of the agent's writes wait on a card, go ahead, or are never allowed: one rule per action (@/core/actions), kept in the
 *  preferences and enforced by the agent's server, so no reply can skip a card. */
function AgentActions() {
  const { actions, agent: { webGuard } } = usePrefs();
  return (
    <>
      <Group title="Permissions" action={<Legend options={RULES} of={ruleOf} />}>
        <ul className="divide-y divide-line">
          {ACTIONS.map((a) => {
            const { name, covers } = ACTION_LABEL[a], rule = actions[a];
            return (
              <li key={a}>
                <Row icon={ACTION_ICON[a]} tone={RULE[rule].tone} title={name} detail={covers}>
                  <Segmented compact label={name} value={rule} options={RULES} of={ruleOf} onPick={(v) => setPrefs({ actions: { [a]: v } })} />
                </Row>
              </li>
            );
          })}
        </ul>
      </Group>
      <Group hint="Web pages, PDFs and attached files can carry instructions.">
        <Row icon={ShieldAlert} tone={webGuard ? "warn" : "dim"} title="Ask after reading outside text" detail={`Then ${RULE_LABEL.auto} asks first.`} htmlFor="web-guard">
          <Switch id="web-guard" checked={webGuard} onCheckedChange={(v) => setPrefs({ agent: { webGuard: v } })} />
        </Row>
      </Group>
    </>
  );
}

/** agent/memory.md: the agent's notes about the owner, which it rewrites itself. Shown, not edited here: it is the agent's record, not a note. */
function Memory() {
  const { data, isPending } = useQuery({ queryKey: ["memory"], queryFn: memory });
  return (
    <Group title="Memory" hint="Written by the agent itself; ask it to change something.">
      <div className="max-h-96 overflow-y-auto px-3 py-2.5">
        <Loaded loading={isPending} blurred={false} skeleton={<Skeleton className="h-24" />}>
          {data?.text.trim() ? <Markdown body={data.text} /> : <Empty icon={Bot} className="py-2"><p className="text-sm text-faint">Nothing yet.</p></Empty>}
        </Loaded>
      </div>
    </Group>
  );
}
