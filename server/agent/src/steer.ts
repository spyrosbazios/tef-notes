// Steering a running turn: POST /agent/chat/:id/steer adds the owner's message to the chat's turn at its next step
// boundary (the AI SDK's experimental steering; the reply shows it as a `steering-message` part, and the saved chat keeps
// it there, which the SDK turns back into a user message on later turns). One turn holds a chat at a time (chats.ts
// `hold`); the request is held until the message is in, or the turn ends without it (`delivered: false`: the client sends
// it normally). It is the owner's own text, so it doesn't taint the turn.
import { z } from "zod";
import { STEER_MAX, type SteerResult } from "@/core/assistant";
import { steeringOf } from "./chats";

const Body = z.object({ text: z.string().trim().min(1).max(STEER_MAX) });

export async function steerRoute(req: Request, id: string): Promise<Response> {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new Response("Bad request: text, 1 to 4000 characters", { status: 400 });
  const steering = steeringOf(id);
  if (!steering) return Response.json({ delivered: false } satisfies SteerResult);
  const outcome = await steering.steer(parsed.data.text);
  return Response.json({ delivered: outcome.type === "delivered" } satisfies SteerResult);
}
