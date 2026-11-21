// A chat beside the dock's (an ask, a note action's run): what closing it does at each point of its life.
import { describe, expect, test } from "bun:test";
import type { UIMessage } from "ai";
import { transientChat, type ChatLike } from "@/lib/transient-chat";

type FakeChat = ChatLike & { id: string; sent: string[] };
const fake = (id: string, status = "ready", lastMessage?: UIMessage): FakeChat => {
  const c: FakeChat = { id, status, lastMessage, sent: [], sendMessage: (m) => { c.sent.push(m.text); } };
  return c;
};
const card = { id: "m", role: "assistant", parts: [{ type: "tool-rewrite_note", toolCallId: "c", state: "approval-requested", input: {} }] } as unknown as UIMessage;

/** A session machine over fakes: `made` resolves the record, `log` what happened. */
function rig() {
  const log: string[] = [], bound: (() => string | null)[] = [];
  let made!: (c: FakeChat | null) => void;
  const t = transientChat<{ about: string }, () => string | null, FakeChat>({
    create: (title, binding, wanted) => new Promise((done) => {
      bound.push(binding);
      made = (c) => { if (c && !wanted()) { log.push(`let go ${c.id}`); done(null); } else done(c); };
      log.push(`create ${title}`);
    }),
    halt: (c) => log.push(`halt ${c.id}`),
    adopt: (c) => log.push(`dock ${c.id}`),
    release: (m) => log.push(`release ${m.about}`),
    changed: () => {},
  });
  return { t, log, bound, made: (c: FakeChat | null) => made(c) };
}

describe("the first message", () => {
  test("makes the chat, then goes, bound to the session while it is open", async () => {
    const r = rig(), chat = fake("c1");
    r.t.open({ about: "words" });
    const began = r.t.begin("Title", "fix this", (alive) => () => (alive() ? "words" : null));
    r.made(chat);
    expect(await began).toBe("sent");
    expect(chat.sent).toEqual(["fix this"]);
    expect(r.bound[0]()).toBe("words");
    r.t.close();
    expect(r.bound[0]()).toBeNull();
  });

  test("closed during Starting…: nothing is sent, the record is let go, no plain chat runs the prompt", async () => {
    const r = rig(), chat = fake("c1");
    r.t.open({ about: "Tidy" });
    const began = r.t.begin("Tidy", "the action's prompt", (alive) => () => (alive() ? "Tidy" : null));
    r.t.close();
    r.made(chat);
    expect(await began).toBe("dropped");
    expect(chat.sent).toEqual([]);
    expect(r.log).toEqual(["create Tidy", "release Tidy", "let go c1"]);
    expect(r.t.now()).toBeNull();
  });

  test("another opened during Starting… drops the first the same way", async () => {
    const r = rig(), chat = fake("c1");
    r.t.open({ about: "Tidy" });
    const began = r.t.begin("Tidy", "prompt", () => () => null);
    r.t.open({ about: "Make a task" });
    r.made(chat);
    expect(await began).toBe("dropped");
    expect(chat.sent).toEqual([]);
    expect(r.t.now()?.meta.about).toBe("Make a task");
  });

  test("a record that could not be made fails, and the session stays for another try", async () => {
    const r = rig();
    r.t.open({ about: "words" });
    const began = r.t.begin("T", "q", () => () => null);
    r.made(null);
    expect(await began).toBe("failed");
    expect(r.t.now()).not.toBeNull();
  });

  test("a follow-up goes on in the same chat", async () => {
    const r = rig(), chat = fake("c1");
    r.t.open({ about: "words" });
    const first = r.t.begin("T", "one", () => () => null);
    r.made(chat);
    await first;
    expect(await r.t.begin("T", "two", () => () => null)).toBe("sent");
    expect(chat.sent).toEqual(["one", "two"]);
    expect(r.log.filter((l) => l.startsWith("create"))).toEqual(["create T"]);
  });
});

describe("closing", () => {
  const started = async (chat: FakeChat) => {
    const r = rig();
    r.t.open({ about: "x" });
    const b = r.t.begin("T", "q", () => () => null);
    r.made(chat);
    await b;
    r.log.length = 0;
    return r;
  };

  test("a reply still running stops; the chat isn't handed on", async () => {
    const r = await started(fake("c1", "streaming"));
    expect(r.t.close()).toBe(false);
    expect(r.log).toEqual(["halt c1", "release x"]);
  });

  test("a card waiting goes to the dock rather than away", async () => {
    const r = await started(fake("c1", "ready", card));
    expect(r.t.close()).toBe(true);
    expect(r.log).toEqual(["release x", "dock c1"]);
  });

  test("the page going: a running reply carries on in the dock, unstopped", async () => {
    const r = await started(fake("c1", "streaming"));
    r.t.leave();
    expect(r.log).toEqual(["release x", "dock c1"]);
  });

  test("Open in chat hands it to the dock; once ended, nothing happens twice", async () => {
    const r = await started(fake("c1"));
    r.t.carry();
    r.t.leave();
    r.t.close();
    expect(r.log).toEqual(["release x", "dock c1"]);
  });
});
