import test from "node:test";
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

test("preview buttons keep the default pointer and use Herdr hover and pressed colors", async t => {
  const r = await runtime(t), file = path.join(r.dir, "note.md"); await fs.writeFile(file, "# Note\n");
  r.props.file = file; await r.start();
  const source = find(r.render(), "preview-source");
  defaultPointer(source); assert.equal(source.attributes.rounded[0], 6); assert.equal(source.attributes.role[0], "button");
  assert.equal(styles(source).bg[0], r.theme.hover); assert.equal(styles(source).text_color[0], r.theme.foreground);
  assert.equal(styles(source, "active").bg[0], r.theme.selected);
  let stopped = 0; r.cx.stop_propagation = () => stopped++;
  source.handlers.on_mouse_down({}, r.cx); source.handlers.on_click({}, r.cx);
  assert.equal(stopped, 2); assert.equal(r.panel.source, true);
  const selected = find(r.render(), "preview-source");
  assert.equal(selected.attributes.bg[0], r.theme.selected);
  assert.equal(styles(selected).bg[0], r.theme.selected);
  const back = find(r.render(), "preview-back");
  defaultPointer(back); assert.equal(back.attributes.disabled[0], true);
  assert.equal(back.attributes.text_color[0], r.theme.dim); assert.equal(back.attributes.hover, undefined);
  assert.equal(back.handlers.on_click, undefined); assert.equal(back.attributes.accessibility_label[0], "Back");
});

test("preview zoom and page controls expose disabled loading and boundary states without pointer changes", async t => {
  const r = await runtime(t), panel = await r.start();
  panel.selected = { file: path.join(r.dir, "image.png"), root: r.dir, on: null }; panel.loading = true; panel.media = null;
  for (const id of ["preview-fit", "preview-zoom-actual", "preview-zoom-in", "preview-zoom-out"]) {
    const control = find(r.render(), id); defaultPointer(control);
    assert.equal(control.attributes.disabled[0], true); assert.equal(control.attributes.hover, undefined);
    assert.equal(control.handlers.on_click, undefined); assert.equal(control.attributes.text_color[0], r.theme.dim);
  }
  panel.loading = false; panel.media = { path: "image.png", width: 640, height: 400 }; panel.zoom = 8;
  assert.equal(find(r.render(), "preview-zoom-in").attributes.disabled[0], true);
  assert.equal(find(r.render(), "preview-zoom-out").attributes.disabled[0], false);
  panel.zoom = 0.05;
  assert.equal(find(r.render(), "preview-zoom-out").attributes.disabled[0], true);
  const plus = find(r.render(), "preview-zoom-in"); defaultPointer(plus);
  assert.equal(plus.attributes.accessibility_label[0], "Zoom in"); assert.equal(plus.attributes.tooltip[0], "Zoom in");
  panel.selected.file = path.join(r.dir, "guide.pdf"); panel.page = 1; panel.total = 2;
  assert.equal(find(r.render(), "preview-previous").attributes.disabled[0], true);
  assert.equal(find(r.render(), "preview-next").attributes.disabled[0], false);
  panel.loading = true; panel.page = 2;
  assert.equal(find(r.render(), "preview-previous").attributes.disabled[0], true);
  assert.equal(find(r.render(), "preview-next").attributes.disabled[0], true);
  panel.selected.on = "server";
  assert.equal(find(r.render(), "preview-open").attributes.disabled[0], true);
});

test("preview tree rows retain the default pointer while highlighting on hover", async t => {
  const r = await runtime(t); await fs.writeFile(path.join(r.dir, "file.txt"), "hello");
  await r.start(); const row = find(r.render(), "preview-file-file.txt");
  defaultPointer(row); assert.equal(styles(row).bg[0], r.theme.hover);
  r.panel.tree.loading = true;
  const refresh = find(r.render(), "preview-refresh");
  defaultPointer(refresh); assert.equal(refresh.attributes.disabled[0], true); assert.equal(refresh.handlers.on_click, undefined);
});
