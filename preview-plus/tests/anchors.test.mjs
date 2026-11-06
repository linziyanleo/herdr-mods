import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { runtime, find, until } from "./runtime.mjs";

test("heading anchors handle duplicate/colliding slugs, Unicode, setext and fenced examples", async t => {
  const state = await runtime(t), { markdownStructure } = await state.load("markdown-structure.js");
  const source = '# Hello *world*!\n# Hello world\n# Hello world-1\n# 中文 标题\nSetext\n---\n\n````md\n# ignored\n```mermaid\ngraph LR\nA-->B\n```\n````\n    # indented\n~~~js\n## ignored too\n~~~\n## Last ##\n';
  const parsed = markdownStructure(source);
  assert.deepEqual(Array.from(parsed.headings, h => h.slug), ["hello-world", "hello-world-1", "hello-world-1-1", "中文-标题", "setext", "last"]);
  assert.equal(parsed.diagrams.length, 0);
  assert.equal(markdownStructure("## foo_bar and _emphasis_\n").headings[0].slug, "foo_bar-and-emphasis");
  const fences = markdownStructure('```mermaid\ngraph LR\nA-->B\n```\n~~~mermaid\nsequenceDiagram\n');
  assert.equal(fences.diagrams.length, 2); assert.equal(fences.diagrams[0].closed, true); assert.equal(fences.diagrams[1].closed, false);
});

test("nested headings and fences keep the surrounding list in one native Markdown block", async t => {
  const state = await runtime(t), { markdownStructure } = await state.load("markdown-structure.js");
  const { stageMarkdown } = await state.load("markdown.js"), file = path.join(state.dir, "lists.md");
  const lists = [
    '- First\n  ## Nested heading\n  Continuation\n- Second',
    '- First\nlazy continuation\n  ## Nested heading\n- Second',
    '1. First\n   Nested setext\n   ---\n2. Second',
    '- First\n\n  ## Nested heading\n\n- Second',
    '- First\n  ```mermaid\n  flowchart LR\n  A-->B\n  ```\n- Second',
    '- First\n  > ## Nested quote\n- Second',
    '-\tFirst\n\t## Nested heading\n- Second',
  ];
  for (const source of lists) {
    const parsed = markdownStructure(source);
    assert.equal(parsed.headings.length, 0, source); assert.equal(parsed.diagrams.length, 0, source);
    const staged = await stageMarkdown(source, { file, root: state.dir, on: null }, { colors: state.theme, font: "Geist" });
    assert.equal(staged.blocks.length, 1, source); assert.equal(staged.blocks[0].text, source);
    const after = markdownStructure(source + '\n\n## After list\n\n  ## Indented top-level\n');
    assert.deepEqual(Array.from(after.headings, h => h.slug), ["after-list", "indented-top-level"]);
  }
  assert.deepEqual(Array.from(markdownStructure('- Item\n---\n  ## After break\n').headings, h => h.slug), ["after-break"]);
  assert.equal(markdownStructure('- Item\n\n```mermaid\nflowchart LR\nA-->B\n```\n').diagrams.length, 1);
  await fs.writeFile(file, lists[0]); state.props = { file }; const panel = await state.start();
  const body = find(state.render(), `preview-markdown-${file}-top`);
  assert.equal(body.nodes.length, 1); assert.equal(body.nodes[0].kind, "markdown"); assert.equal(body.nodes[0].value, lists[0]);
  assert.equal(panel.headings.length, 0);
});

test("only an open list paragraph accepts lazy continuation before a top-level setext heading", async t => {
  const state = await runtime(t), { markdownStructure } = await state.load("markdown-structure.js");
  const exact = '- # Item\nAfter list\n==========\n';
  const parsed = markdownStructure(exact);
  assert.deepEqual(Array.from(parsed.headings, h => h.slug), ["after-list"]);
  assert.equal(parsed.headings[0].start, exact.indexOf("After list"));
  const blocks = [
    '- Item\n  ## Nested heading\n',
    '- Item\n  ---\n',
    '- ```js\n  const value = 1;\n  ```\n',
    '- ```js\n  const value = 1;\n',
    '-     indented code\n',
    '- > # Quoted heading\n',
    '- - # Nested heading\n',
  ];
  for (const block of blocks) {
    const source = block + 'After list\n==========\n';
    assert.deepEqual(Array.from(markdownStructure(source).headings, h => h.slug), ["after-list"], source);
  }
  for (const block of ['- # Item\n', '- Item\n\n', '- ```js\n  code\n  ```\n', '- > # Heading\n']) {
    const source = block + '  Paragraph\nlazy continuation\n  ## Nested heading\n- Next\n';
    assert.equal(markdownStructure(source).headings.length, 0, source);
  }
  assert.equal(markdownStructure('- > Paragraph\nlazy continuation\n  ## Nested heading\n').headings.length, 0);
  const { stageMarkdown } = await state.load("markdown.js");
  const staged = await stageMarkdown(exact, { file: path.join(state.dir, "list.md"), on: null }, { colors: state.theme, font: "Geist" });
  assert.equal(staged.blocks.length, 2); assert.equal(staged.blocks[1].heading.slug, "after-list");
  assert.equal(staged.blocks.map(block => block.text).join(""), exact);
});

test("same-document anchors and contents retain editor, draft, source and heading history", async t => {
  const state = await runtime(t), file = path.join(state.dir, "readme.md");
  await fs.writeFile(file, "# Top\n\n## Details\n\nOriginal.\n\n## Details\n\nSecond.\n"); state.props = { file };
  const panel = await state.start(), code = panel.code;
  panel.setSource(true, state.cx); state.edit(panel.text + "\n## Draft heading\n"); panel.setSource(false, state.cx); await until(() => !panel.markdownBusy);
  find(state.render(), "preview-contents").handlers.on_click({}, state.cx); assert.equal(panel.contents, true);
  panel.follow("#details-1", state.cx); assert.equal(panel.anchor, "details-1"); assert.equal(panel.code, code); assert.equal(panel.history.length, 1);
  assert.ok(find(state.render(), "preview-whole-document")); assert.equal(panel.dirty(), true);
  panel.follow("#draft-heading", state.cx); assert.equal(panel.anchor, "draft-heading"); panel.back(state.cx); await until(() => !panel.markdownBusy);
  assert.equal(panel.anchor, "details-1"); assert.equal(panel.code, code);
  panel.follow("#missing", state.cx); assert.match(panel.actionError, /Heading not found/); assert.equal(panel.anchor, "details-1");
  panel.follow("#%ZZ", state.cx); assert.match(panel.actionError, /invalid heading/);
  panel.follow("#", state.cx); assert.equal(panel.anchor, ""); panel.back(state.cx); await until(() => !panel.markdownBusy); assert.equal(panel.anchor, "details-1");
  assert.match(panel.document.text, /Draft heading/); assert.doesNotMatch(await fs.readFile(file, "utf8"), /Draft heading/);
});

test("cross-document anchors preserve encoded paths, machine/root and draft history", async t => {
  const state = await runtime(t), file = path.join(state.dir, "a.md"), other = path.join(state.dir, "b name.md");
  await fs.writeFile(file, "# A\n\n## Saved\n"); await fs.writeFile(other, "# B\n\n## 中文 标题\n"); state.props = { file };
  const panel = await state.start(); panel.setSource(true, state.cx); state.edit(panel.text + "draft\n");
  panel.follow("b%20name.md#%E4%B8%AD%E6%96%87-%E6%A0%87%E9%A2%98", state.cx); await state.settle();
  assert.equal(panel.anchor, "中文-标题"); assert.equal(panel.selected.root, state.dir); assert.equal(panel.source, false);
  panel.back(state.cx); await state.settle(); assert.equal(panel.source, true); assert.match(panel.text, /draft/); assert.equal(panel.dirty(), true);
  panel.follow("b%20name.md#absent", state.cx); await state.settle(); assert.match(panel.actionError, /Heading not found/); assert.equal(panel.anchor, "");
  const { resolveLink } = await state.load("paths.js"); assert.equal(resolveLink("/r/a.md", "../b.md#part").anchor, "part");
});
