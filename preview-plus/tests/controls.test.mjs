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
  assert.equal(find(r.render(), "preview-zoom-percent").attributes.disabled[0], true);
  for (const id of ["preview-fit", "preview-zoom-in", "preview-zoom-out"]) {
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

test("editable percentage follows fitted dimensions and applies only valid submitted values", async t => {
  const r = await runtime(t), panel = await r.start();
  panel.selected = { file: path.join(r.dir, "image.png"), root: r.dir, on: null };
  panel.media = { path: "image.png", width: 1000, height: 500 }; panel.loading = false;
  panel.measure({ width: 532, height: 532 }, r.cx);
  r.render(); await r.settle();
  assert.equal(panel.zoomInput.value(), "50%");
  const input = find(r.render(), "preview-zoom-percent").value;
  const enter = text => {
    input.handlers.focus({}, r.cx); input.set_value(text); input.handlers.change({}, r.cx); input.handlers.submit({}, r.cx);
  };
  enter("125.5%"); assert.equal(panel.zoom, 1.255); assert.equal(panel.mediaSize().width, 1255);
  enter("wrong"); assert.equal(panel.zoom, 1.255); assert.equal(input.value(), "125.5%");
  enter("900"); assert.equal(panel.zoom, 8); assert.equal(input.value(), "800%");
  enter("0"); assert.equal(panel.zoom, 0.05);
  input.set_value("100"); input.handlers.change({}, r.cx); input.handlers.blur({}, r.cx);
  assert.equal(panel.zoom, 1);
  r.zoom = 1.2; assert.ok(Math.abs(panel.mediaSize().width * r.zoom - 1000) < 0.001);
  panel.setZoom(null, r.cx); panel.measure({ width: 638.4, height: 638.4 }, r.cx);
  r.render(); await r.settle(); assert.equal(input.value(), "60%");
  input.handlers.focus({}, r.cx); input.handlers.blur({}, r.cx); assert.equal(panel.zoom, null);
});

test("wheel lines and trackpad pixels zoom continuously; Shift preserves panning", async t => {
  const r = await runtime(t), panel = await r.start();
  panel.media = { path: "image.png", width: 1000, height: 500 }; panel.loading = false; panel.zoom = 1;
  let stopped = 0; r.cx.stop_propagation = () => stopped++;
  const scroll = panel.body("image", r.theme).handlers.on_scroll_wheel;
  scroll({ delta: { x: 0, y: 40 }, delta_lines: { x: 0, y: 1 }, modifiers: {} }, r.cx);
  assert.ok(panel.zoom > 1);
  scroll({ delta: { x: 0, y: -40 }, modifiers: {} }, r.cx);
  assert.ok(Math.abs(panel.zoom - 1) < 0.000001);
  scroll({ delta: { x: 0, y: 40 }, modifiers: { shift: true } }, r.cx);
  assert.equal(stopped, 3);
  panel.setZoom(8, r.cx); scroll({ delta: { y: 100 }, modifiers: {} }, r.cx); assert.equal(panel.zoom, 8);
  panel.setZoom(0.05, r.cx); scroll({ delta: { y: -100 }, modifiers: {} }, r.cx); assert.equal(panel.zoom, 0.05);
});

test("dragging pans enlarged media in both directions, respects app zoom and stops on release", async t => {
  const r = await runtime(t), panel = await r.start();
  panel.media = { path: "image.png", width: 1000, height: 800 }; panel.loading = false;
  r.zoom = 1.2; panel.setZoom(2, r.cx);
  const canvas = panel.body("image", r.theme);
  canvas.handlers.on_mouse_down({ position: { x: 200, y: 200 } }, r.cx);
  canvas.handlers.on_mouse_move({ position: { x: 320, y: 260 } }, r.cx);
  assert.equal(panel.pan.x, 100); assert.equal(panel.pan.y, 50);
  canvas.handlers.on_mouse_up({}, r.cx);
  canvas.handlers.on_mouse_move({ position: { x: 400, y: 400 } }, r.cx);
  assert.equal(panel.pan.x, 100);
  canvas.handlers.on_mouse_down({ position: { x: 200, y: 200 } }, r.cx);
  canvas.handlers.on_hover(false, r.cx); assert.equal(panel.drag, null);
  panel.setZoom(null, r.cx); assert.equal(panel.pan.x, 0); assert.equal(panel.pan.y, 0);
});

test("preview tree rows retain the default pointer while highlighting on hover", async t => {
  const r = await runtime(t); await fs.writeFile(path.join(r.dir, "file.txt"), "hello");
  await r.start(); const row = find(r.render(), "preview-file-file.txt");
  defaultPointer(row); assert.equal(styles(row).bg[0], r.theme.hover);
  r.panel.tree.loading = true;
  const refresh = find(r.render(), "preview-refresh");
  defaultPointer(refresh); assert.equal(refresh.attributes.disabled[0], true); assert.equal(refresh.handlers.on_click, undefined);
});
