import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { runtime, until } from "./runtime.mjs";

const flow = "flowchart LR\nA[Read] --> B[Preview]";
test("bundled diagrams become native SVGs without CSS variables, network fonts or runtime programs", async t => {
  const state = await runtime(t), { diagram } = await state.load("mermaid.js");
  const look = { colors: state.theme, font: "Geist" };
  const sources = [flow, "sequenceDiagram\nAlice->>Bob: Hello", "stateDiagram-v2\n[*] --> Ready\nReady --> Done", "classDiagram\nclass Document {\n+save()\n}\nDocument --> Draft", "erDiagram\nUSER ||--o{ FILE : owns"];
  for (const source of sources) {
    const media = await diagram(source, look); assert.ok(media.width > 0 && media.height > 0);
    const svg = await fs.readFile(path.join(state.dir, "app", media.path), "utf8");
    assert.match(svg, /^<svg/); assert.doesNotMatch(svg, /var\(|color-mix\(|@import/); assert.match(svg, /Geist/);
  }
  assert.equal(state.calls.length, 0);
});

test("diagram cache includes content, every theme color and font; malformed/oversized/unsupported inputs fail", async t => {
  const state = await runtime(t), { diagram } = await state.load("mermaid.js"), look = { colors: state.theme, font: "Geist" };
  const first = await diagram(flow, look), repeat = await diagram(flow, look); assert.equal(first, repeat);
  const color = await diagram(flow, { ...look, colors: { ...state.theme, foreground: "#111111" } }); assert.notEqual(color.path, first.path);
  const font = await diagram(flow, { ...look, font: "Arial" }); assert.notEqual(font.path, first.path);
  const content = await diagram(flow.replace("Preview", "Save"), look); assert.notEqual(content.path, first.path);
  await assert.rejects(diagram("pie\n\"A\": 2", look), /Supported diagrams/);
  await assert.rejects(diagram("flowchart LR\n" + "A".repeat(24000), look), /too large/);
  await assert.rejects(diagram("sequenceDiagram\ninvalid syntax that cannot be a message", look));
});

test("Markdown shows diagram errors and original source without losing headings or drafts", async t => {
  const state = await runtime(t), file = path.join(state.dir, "mermaid.md");
  const source = '# Diagrams\n\n```mermaid\n' + flow + '\n```\n\n## Unsupported\n\n```mermaid\npie\n"A":2\n```\n\n```mermaid\nflowchart LR\n';
  await fs.writeFile(file, source); state.props = { file }; const panel = await state.start();
  const blocks = panel.markdownBlocks.filter(block => block.diagram);
  assert.equal(blocks.length, 3); assert.ok(blocks[0].media); assert.match(blocks[1].error, /Supported/); assert.match(blocks[2].error, /Unclosed/);
  assert.match(blocks[1].text, /pie/); panel.setSource(true, state.cx); state.edit(source + "draft"); panel.setSource(false, state.cx); await until(() => !panel.markdownBusy);
  assert.equal(panel.dirty(), true); assert.equal(await fs.readFile(file, "utf8"), source); assert.match(panel.text, /draft/);
});

test("late diagram staging cannot overwrite a newer target or theme", async t => {
  const state = await runtime(t), a = path.join(state.dir, "a.md"), b = path.join(state.dir, "b.json");
  await fs.writeFile(a, '```mermaid\n' + flow + '\n```'); await fs.writeFile(b, '{"new":true}');
  const diskRead = file => fs.readFile(file, "utf8").catch(e => { if (e.code === "ENOENT") return null; throw e; });
  let release; state.hooks.read = file => file.endsWith(".svg") ? new Promise(resolve => { release = () => resolve(null); }) : diskRead(file);
  state.props = { previewStack: "files" }; const panel = await state.start(); panel.show({ file: a }, state.cx); await until(() => Boolean(release));
  panel.show({ file: b }, state.cx); await state.settle(); state.hooks.read = null; release(); await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(panel.selected.file, b); assert.equal(panel.dataPreview.value.new, true); assert.equal(panel.markdownBlocks, null);
  state.hooks.read = null; panel.show({ file: a }, state.cx); await state.settle(); const old = panel.markdownBlocks[0].media.path;
  state.theme = { ...state.theme, foreground: "#123456" }; state.render(); await until(() => panel.markdownBlocks[0].media.path !== old);
  assert.equal(panel.text, await fs.readFile(a, "utf8"));
});
