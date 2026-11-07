// The editor's markdown: parse then serialize must reach a fixed point, and say what the note said.
import { describe, expect, test } from "bun:test";
import { EditorState, TextSelection } from "prosemirror-state";
import { commands, isActive } from "../src/editor/commands";
import { normalizeBody, parse, serialize } from "../src/editor/markdown";

const once = (md: string) => serialize(parse(md));

const SAMPLE = `# Garage door codes

Some *emphasis*, **strong**, ~~gone~~, \`code\`, and a [link](https://example.com/a_(b) "Title").
Bare https://example.com/path and <https://example.org> autolinks. A line
break typed here stays one.

## Λίστα αγορών

Καλημέρα κόσμε — τα νέα είναι \`καλά\`, [σύνδεσμος](https://el.wikipedia.org/wiki/Ελλάδα) και **έντονα**.

- one
- two
  - nested a
  - nested b
    1. deep ordered
    2. second
- three

* a different bullet list

1. first
2. second
3. third

- [ ] open task
- [x] done task
  - [ ] nested task
- plain item

1. [x] numbered task
2. [ ] another

> quoted text
> - with a list
>
> and a second paragraph

\`\`\`ts
const x = "a | b";
\`\`\`

~~~
tilde fence
~~~

    indented code

| Name | Qty | Note |
| :--- | ---: | :---: |
| apple | 3 | a \\| pipe |
| κρασί | 12 | \`x\` and **b** |
| empty | | |

![a caption](../attachments/20261005-garage-door-codes/20261005-101500.jpg)

![](../attachments/20261005-garage-door-codes/20261005-101501.jpg)

---

Snake_case_word, 2 * 3 = 6, a_b, 5 < 6, \\*not emphasis\\*, \\[not a link\\](x), &amp; and &copy;.

<details>
<summary>Raw html</summary>

hidden

</details>

Inline <kbd>Ctrl</kbd> html and a<br>break.
`;

describe("round trip", () => {
  test("a GFM sample reaches a fixed point", () => {
    const a = once(SAMPLE);
    expect(once(a)).toBe(a);
    expect(normalizeBody(SAMPLE)).toBe(a);
  });

  test("the sample keeps its structure", () => {
    const md = once(SAMPLE);
    for (const want of [
      "# Garage door codes", "## Λίστα αγορών", "~~gone~~", "`code`", "**strong**", "*emphasis*",
      '[link](https://example.com/a_(b) "Title")', "<https://example.org>", "Bare https://example.com/path and",
      "- [ ] open task", "- [x] done task", "  - [ ] nested task", "1. [x] numbered task",
      "| Name | Qty | Note |", "| :--- | ---: | :---: |", "a \\| pipe", "| empty |  |  |",
      "```ts\nconst x = \"a | b\";\n```", "    1. deep ordered",
      "![a caption](../attachments/20261005-garage-door-codes/20261005-101500.jpg)",
      "![](../attachments/20261005-garage-door-codes/20261005-101501.jpg)",
      "Snake_case_word", "2 * 3 = 6", "\\*not emphasis\\*", "<details>", "<kbd>Ctrl</kbd>", "a\nbreak",
      "σύνδεσμος", "https://el.wikipedia.org/wiki/Ελλάδα",
    ]) expect(md).toContain(want);
  });

  test("a typed line break stays a line break", () => {
    expect(once("one\ntwo\n")).toBe("one\ntwo\n");
    expect(once("one  \ntwo\n")).toBe("one\ntwo\n");
  });

  test("an already clean body is returned untouched", () => {
    const clean = "# T\n\nbody *x*\n\n- [ ] a\n- [x] b\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n";
    expect(normalizeBody(clean)).toBe(clean);
  });

  test("an empty body", () => {
    expect(normalizeBody("")).toBe("");
    expect(normalizeBody("\n\n")).toBe("");
  });

  test("checkboxes: only `[ ]`/`[x]` followed by a blank or the line's end", () => {
    expect(once("- [x]draft\n")).toBe("- [x]draft\n");
    expect(once("- \\[ ] literal\n")).toBe("- \\[ ] literal\n");
    expect(once("- [X] big\n")).toBe("- [x] big\n");
    const tasks: (boolean | null)[] = [];
    parse("- [ ] a\n- [x] b\n- c\n").descendants((n) => { if (n.type.name === "list_item") tasks.push(n.attrs.checked); });
    expect(tasks).toEqual([false, true, null]);
  });

  test("braces trailing a checkbox line are plain text and come back byte for byte", () => {
    const md = [
      "## Errands",
      "",
      "- [ ] Call plumber {id:k3f9 when:2026-11-03 due:2026-11-10 every:1w remind:09:00}",
      "  - [ ] find number {id:c1a2}",
      "  - [x] ask neighbour {id:n3b4 done:2026-10-30}",
      "- [ ] Water plants {id:w1p2 when:2026-11-01 evening every:+3d}",
      "- [ ] Gym {id:g7m8 every:mon,thu}",
      "- [ ] Read *Dune* {id:r9z8 someday x:y_z}",
      "- [x] Renew passport {id:p2a1 done:2026-10-30}",
      "- [ ] Use {braces} in text {id:b0b0}",
      "- [ ] {id:e1e2}",
      "",
      "1. [ ] numbered {id:n1n2 due:2026-12-31}",
      "",
    ].join("\n");
    expect(once(md)).toBe(md);
    expect(once(once(md))).toBe(md);
  });

  test("touching lists stay two lists", () => {
    const md = "- a\n\n\n* b\n";
    const a = once(md);
    expect(once(a)).toBe(a);
    let lists = 0;
    parse(a).forEach(() => lists++);
    expect(lists).toBe(2);
  });

  test("tight and loose lists keep their spacing", () => {
    expect(once("- a\n- b\n")).toBe("- a\n- b\n");
    expect(once("- a\n\n- b\n")).toBe("- a\n\n- b\n");
  });

  test("a PDF attachment's link is an ordinary link, kept as written", () => {
    const md = "[Tax form 2026.pdf](../attachments/20261001-taxes/tax-form-2026.pdf)\n";
    expect(once(md)).toBe(md);
    const bracketed = once("[Tax \\[2026\\].pdf](../attachments/20261001-taxes/tax-form-2026.pdf)\n");    // the app escapes brackets in the label; the editor needn't
    expect(once(bracketed)).toBe(bracketed);
    expect(bracketed).toContain("(../attachments/20261001-taxes/tax-form-2026.pdf)");
  });

  test("links are written as they were read", () => {
    const md = "[Ελλάδα](https://el.wikipedia.org/wiki/Ελλάδα) [n](20261001-foo.md) [s](<a b.md>)\n";
    expect(once(md)).toBe(md);
  });
});

describe("format tools", () => {
  const at = (md: string, needle: string) => {
    const doc = parse(md);
    let pos = 0;
    doc.descendants((n, p) => { if (n.isText && n.text!.includes(needle)) pos = p + 1; });
    return EditorState.create({ doc, selection: TextSelection.create(doc, pos) });
  };

  test("a checklist item is the checklist tool, not the bulleted list tool", () => {
    const task = at("- [ ] buy\n- plain\n", "buy"), plain = at("- [ ] buy\n- plain\n", "plain");
    expect(isActive(task, "taskList")).toBe(true);
    expect(isActive(task, "bulletList")).toBe(false);
    expect(isActive(plain, "bulletList")).toBe(true);
    expect(isActive(plain, "taskList")).toBe(false);
  });

  test("the bulleted list tool on a checklist item makes it a plain bullet", () => {
    let state = at("- [ ] buy\n", "buy");
    commands.bulletList(state, (tr) => { state = state.apply(tr); });
    expect(serialize(state.doc)).toBe("- buy\n");
  });

  test("move swaps a list item with its neighbour, nested items and checkbox with it, and the cursor follows", () => {
    let state = at("- [ ] one\n- [x] two\n  - under\n- three\n", "two");
    const run = (name: "moveUp" | "moveDown") => commands[name](state, (tr) => { state = state.apply(tr); });
    expect(run("moveUp")).toBe(true);
    expect(serialize(state.doc)).toBe("- [x] two\n  - under\n- [ ] one\n- three\n");
    expect(state.selection.$from.parent.textContent).toBe("two");
    expect(run("moveUp")).toBe(false);
    run("moveDown"); run("moveDown");
    expect(serialize(state.doc)).toBe("- [ ] one\n- three\n- [x] two\n  - under\n");
    expect(run("moveDown")).toBe(false);
    expect(commands.moveUp(at("plain\n", "plain"))).toBe(false);
  });
});
