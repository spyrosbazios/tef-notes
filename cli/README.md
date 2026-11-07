# TEF Notes CLI

<!-- reviewed: 2026-11-06 -->

TEF Notes from a terminal: notes and tasks, for you and for coding agents. It is the same client the phone
uses (`packages/core/src/pocketbase.ts`), so every write is a compare-and-swap on the record's `rev`: nothing here
overwrites an edit it has not seen. The note format and the write contract are in
[`../ARCHITECTURE.md`](../ARCHITECTURE.md).

A coding agent can read and append to your notes with it, and tick tasks, without any access to files in this
repository.

## Setup

You need [bun](https://bun.sh), the whole repository cloned (the CLI imports [`../packages/core`](../packages/core/README.md)),
and a running server ([`../server/README.md`](../server/README.md)).

```sh
cd cli && bun install
bun tefnotes.ts server https://your-server:port    # once per machine
bun tefnotes.ts ls
```

`server` checks that the address answers like a TEF Notes server, then keeps it in
`${XDG_STATE_HOME:-~/.local/state}/tefnotes/server.json`.

To get a plain `tefnotes` command, symlink the script onto your `PATH` (it starts with a `bun` shebang and is
executable):

```sh
ln -s "$PWD/tefnotes.ts" ~/.local/bin/tefnotes
```

or use a shell alias, `alias tefnotes='bun /path/to/cli/tefnotes.ts'`. The package also declares a `bin`, so
`bun link` should work too; the symlink is what has been tested.

## Commands

`tefnotes --help` prints this list. `<id>` is `20261005-lidl`, `notes/20261005-lidl.md`, or `memory`.

| Command | Does |
|---|---|
| `server <url>` | Where the notes are |
| `ls [tag]` | Notes, pinned first then newest: id, title, tags, pinned |
| `tags` | The defined tags: name, colour, description |
| `tags --describe [--write]` | Descriptions the server writes from each tag's notes; printed, or with `--write` saved over the existing ones |
| `cat <id>` | A note's whole file; its `rev` goes to stderr |
| `links <id>` | What is linked to a note and from it: `← task <task-id> · title · about` for a task about it, `→ <type> <id> · role` for what it points at |
| `grep <words…>` | Notes holding every word |
| `new <title> [< body]` | A new note, body from stdin; prints its id |
| `append <id> [< text]` | Adds text at the end (one line becomes a bullet) |
| `put <id> <rev> [< file]` | Replaces the whole file, if the note is still at `<rev>` |
| `edit <id>` | Opens `$EDITOR`; edits made meanwhile are merged in |
| `rm <id> <rev>` | Deletes the note, photos and all, if it is still at `<rev>` |
| `memory` | The in-app agent's memory file |
| `export <dir>` | Every note as `<dir>/notes/<file>.md`, and the photos and PDFs they link as `<dir>/attachments/<note-id>/<name>` |
| `import <dir> [--dry-run] [--update]` | Every `.md` under `<dir>` as a note (an export comes back unchanged; any Markdown folder works), the files its links point at as its attachments. A note whose id is already there is skipped; `--update` writes over it at its current rev |
| `today` | Tasks to do today (and overdue), then this evening's |
| `tasks [view]` | `inbox` (default), `today`, `upcoming`, or `logbook`; each task line ends `about <note ids>` when it is linked to notes |
| `add <title> [options]` | A task, to the Inbox; prints its id |
| `done <task-id>` | Ticks a task (a repeating one gets its next round, linked to the same notes); the first letters of an id do |
| `link <task-id> <id…>` | Makes a task about these notes |
| `unlink <task-id> <id…>` | The task is no longer about them |

`add` takes `--when <day>`, `--evening`, `--due <day>`, `--every <1d|2w|1m|1y|+3d|mon,thu>`,
`--remind <HH:MM>` and `--note <id>`, which can be repeated: the task is about every note given
(a link per note, see Links in [`../ARCHITECTURE.md`](../ARCHITECTURE.md)); a `<day>` is `YYYY-MM-DD`,
`today` or `tomorrow`.

Links carry no `rev` (making or removing one changes neither end), so `add --note`, `link` and `unlink` need none, and
each is safe to repeat: a link already there stays, and one already gone is done.

## Concurrency: the rev rules

- `cat` prints the note's `rev` on stderr. `put` and `rm` take it back and refuse if the note moved since. That
  refusal is the point: read the note again and redo the change; never retry with the newer `rev` without looking.
- `append` re-reads and retries, since adding at the end cannot clash. `edit` merges an edit made meanwhile the way
  the phone does, and refuses on overlap, leaving your text in a temp file.
- `grep` is the server's case-insensitive `LIKE`; Greek accents (tonos) must match.
- Notes are yours: append or edit what you mean to, and do not reorganise unasked, least of all from an agent.

## Development

```sh
cd cli && bun run typecheck
```

## Security

There is no sign-in: anything that can reach the server can read, write and delete every note. Keep the server on a
private network, and never expose it to the public internet.
