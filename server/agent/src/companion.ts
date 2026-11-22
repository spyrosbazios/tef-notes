// The native companion's routes (the contract is packages/core/src/companion.ts): the feeds its widgets draw and the two
// writes they make, a tick and a new task. Everything is read fresh on each request and shaped by the core, so the
// companion holds no rules: it is told what to draw, where each row opens in the web app, and in which colours. The
// task writes go through the task application service (application/todo.ts): a rev compare-and-swap, a repeating task rolled over. The
// lens is one of the owner's preferences, saved as every client saves one (prefs.ts): the record read, one path changed.
import { helloOf, lensPickOf, newTaskOf, notesFeed, ownerLook, taskListOf, tasksFeed } from "@/core/companion";
import { activeLens, inheritTags, type Lens } from "@/core/lens";
import * as pb from "@/core/client/pocketbase";
import type { Prefs } from "@/core/prefs";
import { ownerPrefs, patchOwnerPrefs } from "./prefs";
import { localDay } from "@/core/days";
import type { Server } from "@/core/server-urls";
import { NoteService } from "./application/notes";
import { TaskService } from "./application/todo";

const refuse = (status: number, error: string) => Response.json({ error }, { status });

type Owner = { prefs: Prefs; lenses: Lens[]; lens: Lens | null };

/** The owner's preferences (none saved yet: the defaults, and no record), their lenses and the one they have on. */
async function owner(server: Server): Promise<Owner> {
  const [{ prefs }, lenses] = await Promise.all([ownerPrefs(server), pb.lenses.list(server)]);
  return { prefs, lenses, lens: activeLens(lenses, prefs.lens) };
}

export async function helloRoute(server: Server): Promise<Response> {
  const { prefs, lens } = await owner(server);
  return Response.json(helloOf(prefs, lens));
}

export async function tasksRoute(req: Request, server: Server): Promise<Response> {
  const [{ prefs, lenses, lens }, tasks] = await Promise.all([owner(server), new TaskService(server).tasks()]);
  return Response.json(tasksFeed(tasks, taskListOf(new URL(req.url).searchParams.get("list")), localDay(Date.now()), lenses, lens, ownerLook(prefs, lens)));
}

export async function notesRoute(server: Server): Promise<Response> {
  const [{ prefs, lenses, lens }, notes] = await Promise.all([owner(server), new NoteService(server).list()]);
  return Response.json(notesFeed(notes, lenses, lens, prefs));
}

/** A new open task, after the last one: planned for today when added from Today, tagged as the lens on tags what is made. It
 *  is made under the companion's own id: one sent again (its answer was lost, or the outbox sent it after it landed) finds that
 *  id taken and answers with the task that is there, never a second. */
export async function addTaskRoute(req: Request, server: Server): Promise<Response> {
  const task = newTaskOf(await req.json().catch(() => null));
  if (!task) return refuse(400, "A task needs a title and an id of its own.");
  const { lens } = await owner(server);
  const r = await new TaskService(server).addTask({ title: task.title, when: task.list === "today" ? localDay(Date.now()) : "", tags: inheritTags(lens) }, [], false, [], task.id);
  return "error" in r ? refuse(409, r.error) : Response.json({ id: r.id });
}

/** A tick. One already ticked (on another screen, since the widget drew it) stays as it is: the wish is met. */
export async function tickRoute(server: Server, id: string): Promise<Response> {
  const todo = new TaskService(server);
  if (!(await todo.task(id))) return refuse(404, "That task is gone.");
  const r = await todo.completeTask(id, true);
  return "error" in r ? refuse(409, r.error) : Response.json({ ok: true });
}

/** The lens on, changed from a widget: for every screen of the owner's, as when the web app's switcher changes it (the one
 *  path over the record at its rev, prefs.ts; the web app hears over the realtime feed). */
export async function lensRoute(req: Request, server: Server): Promise<Response> {
  const pick = lensPickOf(await req.json().catch(() => null));
  if (pick === null) return refuse(400, "Which lens?");
  const { lenses } = await owner(server);
  if (pick && !lenses.some((l) => l.rec === pick)) return refuse(404, "That lens is gone.");
  await patchOwnerPrefs(server, { lens: pick || null });
  return Response.json({ ok: true });
}
