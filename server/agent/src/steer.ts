// Steering a running turn: POST /agent/chat/:id/steer adds the owner's message to the chat's turn at its next step
// boundary (the AI SDK's experimental steering; the reply shows it as a `steering-message` part, and the saved chat keeps
// it there, which the SDK turns back into a user message on later turns). One turn per chat runs at a time; the request
// is held until the message is in, or the turn ends without it (`delivered: false`: the client sends it normally).
// It is the owner's own text, so it doesn't taint the turn.
import { experimental_createSteering as createSteering, type Experimental_Steering as Steering } from "ai";
import { z } from "zod";
import { STEER_MAX, type SteerResult } from "@/core/assistant";

const running = new Map<string, Steering>();

/** A steering object for chat `id`'s turn, registered until `done` is called. A newer turn of the same chat replaces it. */
export function steeringFor(id: string): { steering: Steering; done: () => void } {
  const steering = createSteering();
  running.set(id, steering);
  return { steering, done: () => { if (running.get(id) === steering) running.delete(id); } };
}

const Body = z.object({ text: z.string().trim().min(1).max(STEER_MAX) });

export async function steerRoute(req: Request, id: string): Promise<Response> {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new Response("Bad request: text, 1 to 4000 characters", { status: 400 });
  const steering = running.get(id);
  if (!steering) return Response.json({ delivered: false } satisfies SteerResult);
  const outcome = await steering.steer(parsed.data.text);
  return Response.json({ delivered: outcome.type === "delivered" } satisfies SteerResult);
}
