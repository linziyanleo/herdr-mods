import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { runtime, find, until } from "./runtime.mjs";

const drain = async r => {
  for (let n = 0; n < 200; n++) {
    await new Promise(resolve => setTimeout(resolve, 5));
    if (!r.panel.document?.saving && !r.panel.loading) return;
  }
  throw new Error("Save did not finish");
};
async function setup(t, name = "sample.txt") {
  const r = await runtime(t), file = path.join(r.dir, name);
  await fs.writeFile(file, "Original\n"); r.props.file = file;
  await r.start(); return r;
}
const click = (r, id) => find(r.render(), id).handlers.on_click({}, r.cx);

test("editing and platform save keys write exact text; own watcher keeps editor and undo state", async t => {
  const r = await setup(t), p = r.panel, code = p.code;
  assert.equal(find(r.render(), "preview-save").handlers.on_click, undefined);
  r.edit("中文\r\nA long line without added line breaks\r\n");
  assert.equal(await fs.readFile(r.props.file, "utf8"), "Original\n");
  p.keyDown({ keystroke: "cmd-s" }, r.cx); await drain(r);
  assert.equal(await fs.readFile(r.props.file, "utf8"), code.value());
  assert.equal(p.dirty(), false); assert.equal(r.storage.has("preview-plus.drafts"), false);
  await r.change(r.dir, [r.props.file]); assert.equal(p.code, code);
  r.platform = "windows"; r.edit("Windows edit\n");
  p.keyDown({ keystroke: "ctrl-s" }, r.cx); await drain(r);
  assert.equal(await fs.readFile(r.props.file, "utf8"), "Windows edit\n");
});

test("wrap and theme rebuilds keep unsaved text; Markdown preview uses that draft", async t => {
  const r = await setup(t, "sample.md"), p = r.panel;
  p.setSource(true, r.cx); r.edit("# Unsaved heading\n\n" + "long text ".repeat(40));
  const text = p.code.value(); click(r, "preview-wrap");
  assert.equal(p.code.soft_wrap, true); assert.equal(p.code.value(), text);
  r.settings.font_size = 17; r.render(); await r.settle();
  assert.equal(p.code.value(), text); assert.equal(p.dirty(), true);
  click(r, "preview-mode"); await r.settle();
  assert.ok(p.markdownBlocks.some(block => block.text?.includes("# Unsaved heading")));
  assert.equal(await fs.readFile(r.props.file, "utf8"), "Original\n");
  click(r, "preview-mode"); click(r, "preview-wrap"); assert.equal(p.code.value(), text); assert.equal(p.code.soft_wrap, false);
});

test("navigation, space changes and reopening the mod recover drafts; discard requires confirmation", async t => {
  const r = await setup(t), p = r.panel, file = r.props.file;
  r.edit("Keep this draft\n");
  const other = path.join(r.dir, "other.txt"); await fs.writeFile(other, "Other\n");
  r.props.file = other; r.render(); await r.settle(); r.edit("Other draft\n");
  r.props.file = file; r.focus.space = "s2"; r.render(); await r.settle();
  assert.equal(p.code.value(), "Keep this draft\n");
  await p.close(); await r.start();
  assert.equal(r.panel.code.value(), "Keep this draft\n");
  click(r, "preview-discard"); assert.equal(r.panel.code.value(), "Keep this draft\n");
  click(r, "preview-cancel-discard"); assert.equal(r.panel.dirty(), true);
  click(r, "preview-discard"); click(r, "preview-discard"); await r.settle();
  assert.equal(r.panel.code.value(), "Original\n");
  r.props.file = other; r.render(); await r.settle(); assert.equal(r.panel.code.value(), "Other draft\n");
});

test("external edits, deletions and failed saves never overwrite or discard a dirty buffer", async t => {
  const r = await setup(t), p = r.panel, file = r.props.file;
  r.edit("My draft\n");
  await fs.writeFile(file, "External\n"); await r.change(r.dir, [file]);
  await until(() => p.document.external);
  assert.equal(p.code.value(), "My draft\n"); assert.equal(p.document.external, true);
  click(r, "preview-save"); await drain(r);
  assert.equal(await fs.readFile(file, "utf8"), "External\n"); assert.match(p.document.saveError, /draft is retained/);
  await fs.rm(file); await r.change(r.dir, [file]);
  p.reload(r.cx); await r.settle(); assert.equal(p.code.value(), "My draft\n");
  click(r, "preview-save"); await drain(r); assert.equal(p.dirty(), true);
  await p.close(); await r.start(); assert.equal(r.panel.code.value(), "My draft\n");
  r.hooks.write = async () => { throw new Error("Permission denied"); };
  r.panel.save(r.cx); await drain(r); assert.match(r.panel.document.saveError, /Permission denied/);
});

test("typing during an in-flight save stays dirty and navigation cannot redirect the write", async t => {
  const r = await setup(t), p = r.panel, file = r.props.file;
  let finish; const writes = [];
  r.hooks.write = (file, text, expected) => new Promise(resolve => {
    writes.push({ file, text, expected }); finish = async () => { await fs.writeFile(file, text); resolve(); };
  });
  r.edit("First draft\n"); p.save(r.cx);
  await new Promise(resolve => setImmediate(resolve));
  r.edit("Second draft\n"); p.save(r.cx); assert.equal(writes.length, 1);
  const other = path.join(r.dir, "other.txt"); await fs.writeFile(other, "Other\n");
  r.props.file = other; r.render(); await r.settle(); await finish(); await drain(r);
  assert.equal(await fs.readFile(other, "utf8"), "Other\n");
  r.props.file = file; r.render(); await r.settle();
  assert.equal(p.code.value(), "Second draft\n"); assert.equal(p.dirty(), true);
  assert.deepEqual(writes, [{ file, text: "First draft\n", expected: "Original\n" }]);
});

test("remote and truncated files stay read-only and cannot save", async t => {
  const r = await setup(t), p = r.panel;
  r.props.on = "remote"; r.render(); await r.settle();
  assert.equal(p.code.readonly, true); assert.equal(find(r.render(), "preview-save"), null);
  r.props.on = null; await fs.writeFile(r.props.file, "x".repeat(400001)); r.render(); await r.settle();
  assert.equal(p.code.readonly, true); assert.equal(find(r.render(), "preview-save"), null);
  p.save(r.cx); assert.equal((await fs.readFile(r.props.file, "utf8")).length, 400001);
});
