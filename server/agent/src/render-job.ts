// What the agent asks of its render process (render.ts runs it, render-child.ts is it), as one typed table: every op, its
// arguments and its answer. pdf.js and the canvas are seconds of CPU on a large PDF or scene, which on the agent's own
// event loop would hold up every chat and Talk's audio relay; so all of it happens in the child, and the agent only awaits.
// A new op is a line in `Args`, a line in `Out` and a handler in render-child.ts: the compiler checks all three.

/** Each op's arguments. `pdf` is the file's bytes; a PDF is opened for the one op and closed after it. */
export type Args = {
  /** A PDF's own text, one string per page, as pdf.js reads it. */
  text: { pdf: Uint8Array };
  /** A PDF's page count. */
  pages: { pdf: Uint8Array };
  /** The PDF's first page as JPEG, `width` pixels wide, `quality` 0–1. */
  thumb: { pdf: Uint8Array; width: number; quality: number };
  /** A JPEG shrunk to `width` pixels wide, as JPEG. */
  shrink: { jpeg: Uint8Array; width: number };
  /** An Excalidraw scene (already checked by core's `sceneProblem`) as PNG. */
  drawing: { scene: unknown };
};

/** Each op's answer. */
export type Out = { text: string[]; pages: number; thumb: Uint8Array; shrink: Uint8Array; drawing: Uint8Array };

export type Op = keyof Args;

/** Parent to child: one job, numbered. */
export type Request = { [K in Op]: { id: number; op: K; args: Args[K] } }[Op];
/** Child to parent: the job's answer, or why it failed. */
export type Response = { id: number; ok: true; value: Out[Op] } | { id: number; ok: false; error: string };
