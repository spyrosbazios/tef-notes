// The agent's side of its render process: pdf.js (a PDF's text, page count, first page) and the canvas (a drawing's PNG, a
// picture shrunk) run in one child process (render-child.ts), never on the agent's event loop, which every chat and Talk's
// audio relay share. One job at a time, in the order asked: four cores, and the chats beside it. Each job has a time
// limit from when the child takes it; one that overruns, or a child that dies (a native crash in pdf.js or the canvas),
// fails that job alone and the child is started again for the next. A process rather than a Bun `Worker`: a worker's
// native crash would take the whole agent with it, and its `terminate()` is documented as experimental
// (https://bun.com/docs/runtime/workers) while a process is simply killed. Messages go over Bun's IPC channel between
// two bun processes, in its "advanced" serialization, which carries a Uint8Array (https://bun.com/docs/runtime/child-process).
// The ops and their types are render-job.ts's.
import { join } from "node:path";
import type { Args, Op, Out, Request, Response } from "./render-job";

/** A job the render process couldn't finish: it threw (`failed`: the file is the trouble, the message says what), it
 *  overran its time (`timeout`) or the process died on it (`died`). */
export class RenderError extends Error {
  constructor(message: string, readonly reason: "failed" | "timeout" | "died") { super(message); }
}

/** How long each op may take once the child has it. */
export const TIMEOUT_MS: Record<Op, number> = { text: 120_000, pages: 30_000, thumb: 60_000, shrink: 30_000, drawing: 30_000 };

type Waiting = { op: Op; args: () => Promise<Args[Op]>; resolve: (v: Out[Op]) => void; reject: (e: unknown) => void };
type Active = { id: number; op: Op; resolve: (v: Out[Op]) => void; reject: (e: unknown) => void; timer: ReturnType<typeof setTimeout> };

export class Renderer {
  private child?: Bun.Subprocess;
  private waiting: Waiting[] = [];
  private active?: Active;
  private busy = false;                 // a job is being prepared or run
  private seq = 0;

  /** `entry`: the child's script; `timeout`: each op's limit in ms (both are the tests' to change). */
  constructor(private entry = join(import.meta.dir, "render-child.ts"), private timeout: Record<Op, number> = TIMEOUT_MS) {}

  /** Runs `op` on `args`, or on what `args` resolves to when its turn comes: bytes to be fetched are fetched then, not
   *  while the job waits, so a burst of jobs doesn't hold every file in memory at once. A rejection of `args` is that
   *  error as it is; a failure of the job is a RenderError. */
  run<K extends Op>(op: K, args: Args[K] | (() => Promise<Args[K]>)): Promise<Out[K]> {
    return new Promise<Out[K]>((resolve, reject) => {
      const make = typeof args === "function" ? (args as () => Promise<Args[K]>) : async () => args;
      this.waiting.push({ op, args: make, resolve: resolve as Waiting["resolve"], reject });
      void this.next();
    });
  }

  /** Ends the process; the next job starts another. */
  stop() { this.kill(); }

  private kill() {
    const child = this.child;
    this.child = undefined;
    child?.kill("SIGKILL");
  }

  private async next(): Promise<void> {
    if (this.busy) return;
    const job = this.waiting.shift();
    if (!job) return;
    this.busy = true;
    let args: Args[Op];
    try { args = await job.args(); } catch (e) {
      this.busy = false;
      job.reject(e);
      return this.next();
    }
    const id = ++this.seq;
    this.active = { id, op: job.op, resolve: job.resolve, reject: job.reject, timer: setTimeout(() => this.fail(id, new RenderError(`${job.op} took longer than ${this.timeout[job.op] / 1000} s`, "timeout")), this.timeout[job.op]) };
    try {
      (this.child ??= this.spawn()).send({ id, op: job.op, args } as Request);
    } catch (e) {
      this.fail(id, new RenderError(`the render process couldn't be reached: ${(e as Error).message}`, "died"));
    }
  }

  private spawn(): Bun.Subprocess {
    const child: Bun.Subprocess = Bun.spawn([process.execPath, this.entry], {
      stdio: ["ignore", "inherit", "inherit"],
      serialization: "advanced",
      ipc: (message) => { if (this.child === child) this.answer(message as Response); },
      onExit: (_proc, code, signal) => {
        if (this.child !== child) return;                       // ended by us
        this.child = undefined;
        if (this.active) this.fail(this.active.id, new RenderError(`the render process ended (${signal ?? `exit ${code}`}) during ${this.active.op}`, "died"));
      },
    });
    child.unref();
    return child;
  }

  private answer(res: Response) {
    const job = this.active;
    if (!job || job.id !== res.id) return;
    clearTimeout(job.timer);
    this.active = undefined;
    this.busy = false;
    if (res.ok) job.resolve(res.value); else job.reject(new RenderError(res.error, "failed"));
    void this.next();
  }

  /** Fails job `id` if it is still the one running, and ends the process it was in: its state is unknown. */
  private fail(id: number, error: RenderError) {
    const job = this.active;
    if (!job || job.id !== id) return;
    clearTimeout(job.timer);
    this.active = undefined;
    this.busy = false;
    this.kill();
    job.reject(error);
    void this.next();
  }
}

let shared: Renderer | undefined;
/** The agent's one render process, started with its first job. */
export const render = () => (shared ??= new Renderer());
