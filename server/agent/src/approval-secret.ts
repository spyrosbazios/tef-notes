// The secret that signs the chat's confirm cards. The AI SDK stamps every approval request with an HMAC over its id, its
// tool call and the call's input (`experimental_toolApprovalSecret`), and refuses to run an approved call whose request
// the server didn't issue: without it a request body that merely says `approval-responded: approved` for a call the model
// never made would run `delete_note` with no card. The secret is the agent's own and never leaves it: a file in the data
// volume (TEF_NOTES_DATA, mode 600), made on first use. Losing it (the volume deleted) costs only the cards waiting at that
// moment: their answer is refused as unsigned, and the owner asks again.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

async function load(): Promise<string> {
  const path = join(process.env.TEF_NOTES_DATA ?? "./data", "approval-secret");
  const had = await readFile(path, "utf8").then((t) => t.trim(), () => "");
  if (had) return had;
  const made = randomBytes(32).toString("hex");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${made}\n`, { mode: 0o600 });
  return made;
}

let secret: Promise<string> | undefined;

/** The signing secret, read once. */
export const approvalSecret = (): Promise<string> => secret ??= load();
