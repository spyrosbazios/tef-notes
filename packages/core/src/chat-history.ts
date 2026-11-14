// Persistence contract, independent of the SDK and today's tool schemas. Parts and metadata
// are opaque JSON: an old tool's input/output must remain available for display and export.
export const CHAT_HISTORY_VERSION = 1;
export type HistoryMessage = {
  id: string;
  role: "system" | "user" | "assistant";
  parts: { type: string; [key: string]: unknown }[];
  [key: string]: unknown;
};
export class ChatHistoryError extends Error {
  constructor(message: string) { super(message); this.name = "ChatHistoryError"; }
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

// Validate the stable part envelope, never a particular tool's input/output schema.
function part(value: unknown): boolean {
  if (!object(value) || typeof value.type !== "string" || !value.type) return false;
  if (value.type === "text" || value.type === "reasoning") return typeof value.text === "string";
  if (value.type === "dynamic-tool" || value.type.startsWith("tool-")) {
    if (typeof value.toolCallId !== "string" || !value.toolCallId || typeof value.state !== "string") return false;
    if (value.type === "dynamic-tool" && typeof value.toolName !== "string") return false;
    if (!["input-streaming", "input-available", "approval-requested", "approval-responded", "output-available", "output-error", "output-denied"].includes(value.state)) return false;
    if (value.state === "approval-requested" || value.state === "approval-responded") {
      if (!object(value.approval) || typeof value.approval.id !== "string") return false;
      if (value.state === "approval-responded" && typeof value.approval.approved !== "boolean") return false;
    }
  }
  return true;
}

/** Missing/zero version is the original messages array. Only legacy empty records allow null. */
export function readChatHistory(record: unknown): HistoryMessage[] {
  if (!object(record)) throw new ChatHistoryError("Malformed chat history record.");
  const version = record.historyVersion;
  if (version !== undefined && version !== null && version !== 0 && version !== CHAT_HISTORY_VERSION)
    throw new ChatHistoryError(`Unsupported chat history version ${String(version)}. Update TEF Notes to open this chat; its history has not been changed.`);
  const messages = record.messages;
  if (version !== CHAT_HISTORY_VERSION && messages == null) return [];
  if (!Array.isArray(messages) || messages.some((m) => !object(m) || typeof m.id !== "string" || !m.id
    || !["system", "user", "assistant"].includes(String(m.role)) || !Array.isArray(m.parts)
    || m.parts.some((p: unknown) => !part(p))))
    throw new ChatHistoryError("Malformed chat history messages. The saved history has not been changed.");
  return messages as HistoryMessage[];
}

/** The single writer: additive version column, keeping the array readable by older clients. */
export function serializeChatHistory(messages: unknown) {
  return { historyVersion: CHAT_HISTORY_VERSION, messages: readChatHistory({ historyVersion: CHAT_HISTORY_VERSION, messages }) };
}
