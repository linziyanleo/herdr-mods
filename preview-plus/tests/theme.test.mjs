import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { runtime, find } from "./runtime.mjs";

test("Preview Plus uses native panel defaults with live Herdr colors and UI fonts", async t => {
  const r = await runtime(t); await fs.writeFile(path.join(r.dir, "file.txt"), "hello");
  await r.start();
  let root = r.render();
  assert.equal(root.attributes.rounded[0], 10); assert.ok(root.attributes.border_1);
  assert.equal(root.attributes.border_color[0], "#ffffff18"); assert.equal(root.attributes.text_size[0], 13);
  assert.equal(root.attributes.font_family[0], "Geist"); assert.equal(root.nodes[0].attributes.h[0], 42);
  const row = find(root, "preview-file-file.txt");
  assert.equal(row.attributes.h[0], 28); assert.equal(row.attributes.rounded[0], 7);
  r.settings.ui_font_family = "Geist Mono";
  r.theme = { ...r.theme, background: "#e7e8e9", foreground: "#202020", border: "#00000018", muted: "#606060" };
  root = r.render();
  assert.equal(root.attributes.font_family[0], "Geist Mono");
  assert.equal(root.attributes.bg[0], r.theme.background); assert.equal(root.attributes.border_color[0], r.theme.border);
  assert.equal(root.attributes.text_color[0], r.theme.foreground);
  assert.equal(find(root, "preview-file-file.txt").nodes[1].attributes.text_color[0], r.theme.foreground);
});

test("cached source follows code font and syntax changes without rereading the file", async t => {
  const r = await runtime(t), file = path.join(r.dir, "sample.ts"); await fs.writeFile(file, "export const ready = true;\n");
  r.props.file = file; const panel = await r.start(), previous = panel.code;
  let reads = 0; r.hooks.read = () => { reads++; throw new Error("Theme changes must not reread source"); };
  r.settings.font_family = "Geist Mono"; r.settings.font_size = 18; r.zoom = 1.2;
  r.theme = { ...r.theme, ansi5: "#b4a9ff", ansi6: "#00aaff", dim: "#a8a29e" };
  r.render(); await r.settle();
  assert.equal(reads, 0); assert.equal(previous.released, true);
  assert.equal(panel.code.font_family, "Geist Mono"); assert.equal(panel.code.font_size, 18);
  assert.equal(panel.code.syntax.keyword, r.theme.ansi5); assert.equal(panel.code.syntax.constant, r.theme.ansi6);
  assert.equal(panel.code.syntax.comment, r.theme.dim);
  assert.equal(panel.code.readonly, false); assert.equal(panel.code.value(), "export const ready = true;\n");
  const current = panel.code; r.render(); await r.settle(); assert.equal(panel.code, current);
});

test("Git marks and error text use Herdr semantic colors", async t => {
  const r = await runtime(t), file = path.join(r.dir, "file.txt"); await fs.writeFile(file, "hello");
  const panel = await r.start(); panel.tree.marks[file] = "M";
  const row = find(r.render(), "preview-file-file.txt");
  assert.equal(row.nodes.at(-1).attributes.text_color[0], r.theme.ansi3);
  panel.actionError = "Could not open";
  const error = r.render().nodes.find(node => node.nodes?.includes("Could not open"));
  assert.equal(error.attributes.text_color[0], r.theme.ansi1);
});
