---
name: tefnotes
description: Read, search, write and organise the user's TEF Notes (notes and Things-style tasks on their self-hosted server) through the `tefnotes` CLI. Use when the user asks to find, read, add to, create or change a note, to add, list, reschedule, tick or delete a task, to link tasks to notes, or to define tags in TEF Notes, or says "my notes", "in tefnotes", "add a task".
license: AGPL-3.0
compatibility: Needs bun, a clone of the tef-notes repository (the CLI imports packages/core) and a shell that reaches the server over the user's private network.
---

# TEF Notes through the CLI

The notes and tasks are the user's. Read and find before writing; change only what they asked for; never reorganise.
Every command: `tefnotes --help`. Setup: [`cli/README.md`](../../cli/README.md).

## Before anything

- **Run every command with `TEF_NOTES_AGENT=1`** (`export TEF_NOTES_AGENT=1` once per shell). Your writes are then
  marked `tainted`, so the in-app assistant treats them like web text and asks before writing after reading them.
  Never leave it off.
- `tefnotes ls` fails with "no server set": ask the user for the server's private address, then `tefnotes server <url>`.
  Never point it at a public address: the server has no sign-in.

## Find

| Want | Command |
|---|---|
| Notes about something, any wording or language | `tefnotes search <words>`: words and meaning; a `meaning` hit may be loose, read it first |
| Notes holding exact words | `tefnotes grep <words>` (Greek tonos must match) |
| Every note, or one tag's | `tefnotes ls [tag]` |
| A note's text | `tefnotes cat <id>`: the file on stdout, its `rev` on stderr |
| Tasks | `tefnotes tasks [inbox\|today\|upcoming\|logbook]`, `tefnotes today` |
| What links to a note | `tefnotes links <id>` |
| Tags you may use | `tefnotes tags` |

Say something isn't in the notes only after `search` with a couple of phrasings.

## Write notes

- Add to a note that fits before making a new one: `printf '%s\n' "text" | tefnotes append <id>` (one line becomes a bullet).
- New note: `tefnotes new "<title>" < body.md`; prints its id. Write in the user's words and language.
- Whole rewrite: `tefnotes cat <id>` (keep the `rev`), change the file, `tefnotes put <id> <rev> < file`.
  A refusal means the note moved since: `cat` again and redo the change from the new text. Never retry with the
  newer rev without re-reading.
- Never `edit` (opens an editor). `rm <id> <rev>` deletes the note and its attachments: only when asked, by name.

## Drawings

A diagram, sketch or wireframe goes into a note as an Excalidraw drawing the user can open and edit in the web app.

1. Write the scene as a file: `{"type":"excalidraw","version":2,"elements":[…]}`. Each element needs `id`, `type`
   (`rectangle`, `ellipse`, `diamond`, `text`, `arrow`, `line`), `x`, `y`, `width`, `height`. Arrows and lines need
   `points` (`[[0,0],[dx,dy]]`, relative to `x`, `y`). A label inside a box is a `text` with `containerId` set to the
   box's id, plus `"boundElements":[{"type":"text","id":"<text id>"}]` on the box. Colours come from Excalidraw's palette:
   blue `#1971c2` on `#a5d8ff`, green `#2f9e44` on `#b2f2bb`, yellow `#f08c00` on `#ffec99`, red `#e03131` on `#ffc9c9`,
   gray `#868e96` on `#dee2e6` (`strokeColor` on `backgroundColor`).
2. `tefnotes draw <id> flow.excalidraw --label "Login flow"`: uploads the scene, the server draws its PNG preview, and a
   link is appended to the note. It prints the drawing's name.
3. To change it later: `tefnotes draw <id> flow.excalidraw --replace <name>.excalidraw`. That replaces the scene and its
   picture and leaves the note's text alone.

Lay a diagram out on a grid, with even gaps and one colour per role. The preview is drawn plainly, and the web app's first
Save replaces it with Excalidraw's own.

## Tasks

- `tefnotes add "<title>" [--when <day>] [--evening] [--due <day>] [--every 1w] [--remind 09:00] [--tag <name>]… [--note <id>]… [--notes "<text>"]`
  prints its id. `<day>`: `YYYY-MM-DD`, `today`, `tomorrow`. No `--when`: it goes to the Inbox.
- `tefnotes set <task-id> [same options] [--title …] [--no-evening]`: `none` clears a value (`--when none`);
  `--tag` replaces the tags.
- `tefnotes done <task-id>` ticks it (a repeating one gets its next round). `tefnotes drop <task-id>` deletes it: only when asked.
- `tefnotes link|unlink <task-id> <note-id>…`: what the task is about. Safe to repeat.
- A task id's first letters are enough when no other task shares them.

## Tags

Only tags from `tefnotes tags`. Define or change one when the user asks: `tefnotes tag <name> [--color <colour>] [--about "<what it means>"]`.
