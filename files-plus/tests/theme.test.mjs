import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { runtime, find } from "./runtime.mjs";

test("retained rows follow same-appearance theme overrides and UI font changes", async t => {
  const r = await runtime(t), { default: Files } = await r.load("main.js");
  const panel = new Files(); panel.init({}, r.cx); await r.drain();
  find(panel.render(r.cx), `file-${r.dir}/home`);
  const chunk = panel.chunks[0].entity;
  r.theme = { ...r.theme, background: "#191918", foreground: "#eeeeec", muted: "#b5b3ad", selected: "#3b3a37" };
  r.settings.ui_font_family = "Geist Mono"; r.settings.ui_font_size = 15;
  panel.render(r.cx); await r.drain();
  const tree = panel.render(r.cx), row = find(tree, `file-${r.dir}/home`);
  assert.equal(find(tree, "files-plus").attributes.bg[0], r.theme.background);
  assert.equal(chunk, panel.chunks[0].entity);
  assert.equal(chunk.snapshot().attributes.font_family[0], "Geist Mono");
  assert.equal(chunk.snapshot().attributes.text_size[0], 15);
  assert.equal(chunk.snapshot().attributes.text_color[0], r.theme.foreground);
  assert.equal(row.nodes[0].attributes.text_color[0], r.theme.muted);
  r.rebuiltRows = 0;
  for (let n = 0; n < 5; n++) find(panel.render(r.cx), "absent");
  await r.drain(); assert.equal(r.rebuiltRows, 0);
});

test("an open source preview updates its code font and syntax without a file reread", async t => {
  const r = await runtime(t), { default: Files } = await r.load("main.js");
  const file = path.join(r.dir, "app.ts"); await fs.writeFile(file, "export const ready = true;\n");
  const panel = new Files(); panel.init({}, r.cx); await r.drain();
  panel.openFile(file, r.dir, r.cx); await r.drain(); const previous = panel.code;
  let reads = 0; r.hooks.beforeRead = async () => { reads++; };
  r.settings.font_family = "Geist Mono"; r.settings.font_size = 17;
  r.theme = { ...r.theme, ansi5: "#b4a9ff", dim: "#a8a29e" };
  panel.render(r.cx); await r.drain();
  assert.equal(reads, 0); assert.equal(previous.released, true);
  assert.equal(panel.code.value, "export const ready = true;\n");
  assert.equal(panel.code.readonly, true);
  assert.equal(panel.code.font_family, "Geist Mono"); assert.equal(panel.code.font_size, 17);
  assert.equal(panel.code.syntax.keyword, r.theme.ansi5); assert.equal(panel.code.syntax.comment, r.theme.dim);
  const current = panel.code;
  panel.render(r.cx); await r.drain(); assert.equal(panel.code, current);
});

test("menus, dialogs and drag pills use Herdr colors and UI typography", async t => {
  const r = await runtime(t), { default: Files } = await r.load("main.js");
  r.settings.ui_font_family = "Geist Mono"; r.settings.ui_font_size = 15;
  for (const role of ["menu", "dialog", "drag"]) {
    r.props = { role, action: "rename", target: r.target("sample.txt"), overlay: role, cursor: { x: 400, y: 200 }, panelBounds: { x: 0, y: 0, width: 100, height: 800 } };
    const view = new Files(); view.init({}, r.cx); await r.drain();
    const el = find(view.render(r.cx), role === "drag" ? "files-drag-pill" : `files-${role}`);
    assert.equal(el.attributes.font_family[0], "Geist Mono"); assert.equal(el.attributes.text_size[0], 15);
    assert.equal(el.attributes.bg[0], r.theme.popover); assert.equal(el.attributes.text_color[0], r.theme.foreground);
    if (role === "dialog") {
      const button = find(el, "dialog-submit");
      assert.equal(button.attributes.bg[0], r.theme.solid); assert.equal(button.attributes.text_color[0], r.theme.solid_foreground);
    }
    view.close();
  }
});

test("text calibration follows UI font and size rather than the terminal font", async t => {
  const r = await runtime(t), m = await r.load("metrics.js");
  find(m.calibrationProbe(() => {}), "metrics-13-0").handlers.on_size_change({ width: 100 }, r.cx);
  assert.equal(m.metrics().unit13, 10);
  r.settings.font_family = "Geist Mono"; assert.equal(m.metrics().unit13, 10);
  r.settings.ui_font_family = "Geist Mono"; assert.equal(m.metrics().unit13, 7.6);
  r.settings.ui_font_size = 15;
  const probe = m.calibrationProbe(() => {});
  assert.equal(probe.attributes.font_family[0], "Geist Mono");
  assert.equal(find(probe, "metrics-13-0").attributes.text_size[0], 15);
  assert.equal(find(probe, "metrics-12-0").attributes.text_size[0], 14);
});
