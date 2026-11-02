import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { runtime, find } from "./runtime.mjs";

function styles(control, name = "hover") {
  const result = {}; let style;
  style = new Proxy(result, { get: (_target, key) => (...args) => { result[key] = args; return style; } });
  control.attributes[name][0](style);
  return result;
}
function defaultPointer(control) {
  assert.ok(control.attributes.cursor_default);
  assert.equal(control.attributes.cursor_pointer, undefined);
}

test("Files Plus header buttons keep the default pointer and highlight only their own surface", async t => {
  const r = await runtime(t), { default: Files } = await r.load("main.js");
  const panel = new Files(); panel.init({}, r.cx); await r.drain();
  let add = find(panel.render(r.cx), "add-folder");
  defaultPointer(add); assert.equal(add.attributes.rounded[0], 6);
  assert.equal(styles(add).bg[0], r.theme.hover); assert.equal(styles(add).text_color[0], r.theme.foreground);
  assert.equal(styles(add, "active").bg[0], r.theme.selected);
  r.platform = "windows"; add = find(panel.render(r.cx), "add-folder");
  defaultPointer(add); assert.equal(add.attributes.disabled[0], true); assert.equal(add.attributes.hover, undefined);
  assert.equal(add.attributes.text_color[0], r.theme.dim); r.calls = [];
  add.handlers.on_click({}, r.cx); assert.equal(r.calls.length, 0);
  r.platform = "macos";
  const file = path.join(r.dir, "source.txt"); await fs.writeFile(file, "hello");
  panel.show(file, r.cx); await r.drain();
  const back = find(panel.render(r.cx), "files-back"); defaultPointer(back);
  assert.equal(back.attributes.rounded[0], 6); assert.equal(styles(back).bg[0], r.theme.hover);
  let stopped = 0; r.cx.stop_propagation = () => stopped++;
  back.handlers.on_mouse_down({}, r.cx); back.handlers.on_click({}, r.cx);
  assert.equal(stopped, 2); assert.equal(panel.file, null);
});

test("menu enabled and disabled entries keep the default pointer and disabled entries have no hover", async t => {
  const r = await runtime(t), { default: Files } = await r.load("main.js");
  r.props = { role: "menu", target: r.target("file.txt"), overlay: "menu" };
  const menu = new Files(); menu.init({}, r.cx);
  const tree = menu.render(r.cx), copy = find(tree, "action-copy"), paste = find(tree, "action-paste");
  defaultPointer(copy); defaultPointer(paste); assert.equal(styles(copy).bg[0], r.theme.hover);
  assert.equal(copy.handlers.on_hover, undefined);
  assert.equal(styles(copy, "active").bg[0], r.theme.selected);
  assert.equal(paste.attributes.disabled[0], true); assert.equal(paste.attributes.text_color[0], r.theme.dim);
  assert.equal(paste.attributes.hover, undefined); paste.handlers.on_click({}, r.cx);
  assert.equal(r.calls.length, 0);
});

test("dialog buttons use native hover opacity and disabled colors without changing the pointer", async t => {
  const r = await runtime(t), { default: Files } = await r.load("main.js");
  r.props = { role: "dialog", action: "new-file", target: r.target("", "dir"), overlay: "dialog" };
  const dialog = new Files(); dialog.init({}, r.cx);
  let submit = find(dialog.render(r.cx), "dialog-submit");
  defaultPointer(submit); assert.equal(submit.attributes.disabled[0], true);
  assert.equal(submit.attributes.bg[0], r.theme.raised); assert.equal(submit.attributes.text_color[0], r.theme.dim);
  assert.equal(submit.attributes.hover, undefined); submit.handlers.on_click({}, r.cx); assert.equal(r.calls.length, 0);
  dialog.input.set_value("file.txt");
  const tree = dialog.render(r.cx); submit = find(tree, "dialog-submit");
  defaultPointer(submit); assert.equal(submit.attributes.bg[0], r.theme.solid);
  assert.equal(submit.attributes.text_color[0], r.theme.solid_foreground);
  assert.equal(styles(submit).opacity[0], 0.88); assert.equal(styles(submit).bg, undefined);
  assert.equal(styles(submit, "active").opacity[0], 0.8);
  const cancel = find(tree, "dialog-cancel"); defaultPointer(cancel);
  assert.equal(styles(cancel).bg[0], r.theme.hover);
  dialog.busy = true;
  assert.equal(find(dialog.render(r.cx), "dialog-cancel").attributes.disabled[0], true);
  r.props = { role: "dialog", action: "trash", target: r.target("file.txt"), overlay: "trash" };
  const trash = new Files(); trash.init({}, r.cx); const danger = find(trash.render(r.cx), "dialog-submit");
  assert.equal(danger.attributes.bg[0], r.theme.ansi1); assert.equal(danger.attributes.text_color[0], r.theme.background);
});
