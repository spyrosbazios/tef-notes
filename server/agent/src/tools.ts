// The agent's tools, registered: every tool module (its tools and a policy for each, tool-policy.ts `toolModule`) is listed
// here once, and nowhere else. A new tool goes in its module with its policy (whether it asks, which owner's action it
// falls under, whether it taints, where it is offered: Talk, a note action's run); a new module goes in MODULES.
// test/tool-policy.test.ts holds the registry to that: no name in two modules, every write under a core action.
import type { ModelMessage } from "ai";
import type { NoteService } from "./application/notes";
import type { TaskService } from "./application/todo";
import type { Attached } from "@/core/assistant";
import { uiModule } from "./assistant";
import { drawingModule } from "./drawings";
import { fileModule } from "./fileTools";
import { fromWeb as classifyReads } from "./guard";
import { noteActionModule } from "./noteActionTools";
import { noteModule } from "./notes";
import { placeModule } from "./placeTools";
import { tagModule } from "./tagTools";
import { todoModule } from "./todoTools";
import type { Policies, Policy, ToolDeps, ToolModule } from "./tool-policy";
import { webModule } from "./webTools";
import { widgetModule } from "./widgetTools";

/** Every tool module the agent has. */
export const MODULES = [
  noteModule, tagModule, webModule, todoModule, placeModule, widgetModule, drawingModule, fileModule, noteActionModule, uiModule,
] as const;

type ToolsOf<M> = M extends ToolModule<infer T> ? T : never;
type Intersect<U> = (U extends unknown ? (u: U) => void : never) extends (i: infer I) => void ? I : never;
/** The agent's tools, as one tool set. */
export type Tools = Intersect<ToolsOf<(typeof MODULES)[number]>>;

/** Whether the chat has read the web: a web tool's result, or a note or task written with web text in view
 *  (`tainted`) read back. */
export const readWeb = (notes: NoteService, todo: TaskService) => async (messages: ModelMessage[]) =>
  fromWeb(messages, new Set([...(await notes.tainted()), ...(await todo.tainted())]));

/** The tools for one request: `notes` and `todo` are its view of the server. `fromPage`: whether a write is marked `tainted`
 *  (web text in view): for a chat, whether it has read the web. `files`: what the owner attached in the chat (attach_file). */
export function tools(notes: NoteService, todo: TaskService, fromPage = readWeb(notes, todo), files: readonly Attached[] = []): Tools {
  const deps: ToolDeps = { notes, todo, fromPage, files };
  return Object.assign({}, ...MODULES.map((m) => m.tools(deps))) as Tools;
}

const policies = Object.assign({}, ...MODULES.map((m) => m.policies)) as Policies<Tools>;
/** Every tool's policy, by name. */
export const toolPolicies = () => policies;

export function policyFor(name: string): Policy | undefined { return (policies as Record<string, Policy>)[name]; }

/** Bind the pure guard to this application's tool policies at the composition boundary. */
export const fromWeb = (messages: ModelMessage[], tainted: ReadonlySet<string> = new Set()) =>
  classifyReads(messages, tainted, policyFor);
