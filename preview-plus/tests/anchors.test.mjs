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
