// What a tap on a notification opens, pure: a task reminder's task (its data carries `task`) or an answer's chat (`chat`).

export type Tap = { to: "task" | "chat"; id: string };

/** The screen a tapped notification's data names; null for anything else. */
export function tapOf(data: Record<string, unknown> | undefined): Tap | null {
  const { chat, task } = data ?? {};
  if (typeof task === "string" && task) return { to: "task", id: task };
  if (typeof chat === "string" && chat) return { to: "chat", id: chat };
  return null;
}
