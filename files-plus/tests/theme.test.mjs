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
  r.settings.ui_font_family = "Geist Mono";
  r.semantic.typography.md = { size: 15, line_height: 23, weight: 500 }; r.semantic.radius.sm = 9; r.semantic.spacing.lg = 22;
  panel.render(r.cx); await r.drain();
  const tree = panel.render(r.cx), row = find(tree, `file-${r.dir}/home`);
  assert.equal(find(tree, "files-plus").attributes.bg[0], r.theme.background);
  assert.equal(chunk, panel.chunks[0].entity);
  assert.equal(chunk.snapshot().attributes.font_family[0], "Geist Mono");
  assert.equal(chunk.snapshot().attributes.text_size[0], 15);
  assert.equal(chunk.snapshot().attributes.line_height[0], "23px"); assert.equal(chunk.snapshot().attributes.font_weight[0], 500);
  assert.equal(row.attributes.rounded[0], 9);
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
  r.settings.ui_font_family = "Geist Mono"; r.semantic.typography.md.size = 15;
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
    assert.equal(el.attributes.border, undefined);
    view.close();
  }
});

test("text calibration follows UI font and size rather than the terminal font", async t => {
  const r = await runtime(t), m = await r.load("metrics.js");
  find(m.calibrationProbe(r.cx, () => {}), "metrics-13-0").handlers.on_size_change({ width: 100 }, r.cx);
  assert.equal(m.metrics(r.cx).unit13, 10);
  r.settings.font_family = "Geist Mono"; assert.equal(m.metrics(r.cx).unit13, 10);
  r.settings.ui_font_family = "Geist Mono"; assert.equal(m.metrics(r.cx).unit13, 0.6 * r.semantic.typography.md.size);
  r.semantic.typography.md.size = 15;
  const probe = m.calibrationProbe(r.cx, () => {});
  assert.equal(probe.attributes.font_family[0], "Geist Mono");
  assert.equal(find(probe, "metrics-13-0").attributes.text_size[0], 15);
  assert.equal(find(probe, "metrics-12-0").attributes.text_size[0], 14);
});

test("spacing and radius changes update retained controls and menu geometry without changing colors", async t => {
  const r = await runtime(t), { default: Files } = await r.load("main.js");
  const panel = new Files(); panel.init({}, r.cx); await r.drain();
  find(panel.render(r.cx), `file-${r.dir}/home`);
  r.semantic.spacing.sm = 11; r.semantic.spacing.lg = 26; r.semantic.radius.sm = 7;
  r.semantic.typography.md.line_height = 30;
  panel.render(r.cx); await r.drain();
  const tree = panel.render(r.cx), row = find(tree, `file-${r.dir}/home`);
  assert.equal(row.attributes.h[0], 30 + r.semantic.spacing.xs);
  assert.equal(row.attributes.rounded[0], 7); assert.equal(row.attributes.gap[0], 11);
  assert.equal(find(tree, "files-tree").attributes.p[0], 11);
  r.props = { role: "menu", target: r.target("sample.txt"), overlay: "menu", pointer: { x: 1200, y: 900 } };
  const menu = new Files(); menu.init({}, r.cx); await r.drain();
  const oldHeight = menu.geometry.height;
  assert.equal(find(menu.render(r.cx), "action-copy").attributes.role[0], "button");
  r.semantic.spacing.sm = 15;
  menu.render(r.cx); await r.drain();
  const next = r.calls.find(call => call.command === "openOverlay").spec;
  assert.ok(next.height > oldHeight); assert.equal(next.frame, undefined);
});

test("Herdr color alpha and configured fonts override the incomplete Base projection", async t => {
  const r = await runtime(t), { appearance, sourceStyle } = await r.load("appearance.js");
  r.theme.border = "#ffffff18"; r.theme.input = "#ffffff24";
  const look = appearance(r.cx);
  assert.equal(look.colors.border, "#ffffff18"); assert.equal(look.colors.input, "#ffffff24");
  assert.equal(look.typography.sans, r.settings.ui_font_family); assert.equal(look.typography.mono, r.settings.font_family);
  r.settings.zoom = 1.2; r.settings.font_size = 18;
  assert.equal(sourceStyle().font_size, 15);
});
