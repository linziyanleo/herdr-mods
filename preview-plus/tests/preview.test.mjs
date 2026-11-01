import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { runtime, find } from "./runtime.mjs";
import { fixtures, png, pdf } from "./fixtures.mjs";

test("relative navigation preserves machine and root, including encoded names and Windows paths", async t => {
  const state = await runtime(t), p = await state.load("paths.js");
  assert.equal(p.resolveLink("/work/docs/start.md", "../photo%20one.png#caption").file, "/work/photo one.png");
  assert.equal(p.resolveLink("C:\\work\\docs\\start.md", "../photo.png").file, "C:/work/photo.png");
  assert.equal(p.dirname("C:/start.md"), "C:/");
  assert.equal(p.normalize("/../../work/file"), "/work/file");
  assert.equal(p.resolveLink("/work/start.md", "https://herdr.dev/#docs").url, "https://herdr.dev/#docs");
  assert.ok(p.resolveLink("/work/start.md", "#heading").anchor);
  assert.throws(() => p.resolveLink("/work/start.md", "javascript:alert(1)"));
  assert.equal(p.target({ file: "relative.md" }), null);
  assert.equal(p.kind("/work/README.MARKDOWN"), "markdown");
  assert.deepEqual(JSON.parse(JSON.stringify(p.imageSize(800, 400, { width: 432, height: 332 }, null))), { width: 400, height: 200 });
});

test("Markdown image extraction handles inline, reference, angle and escaped destinations while preserving code", async t => {
  const state = await runtime(t), { imageReferences } = await state.load("markdown.js");
  const text = '![a](one.png "Title")\n![b](<two words.svg>)\n![c](three\\(x\\).png)\n![d][ref]\n![ref][]\n[ref]: four.png "Title"\n`![x](inline.png)`\n```md\n![x](fenced.png)\n```\n    ![x](indented.png)\n';
  assert.deepEqual(Array.from(imageReferences(text), ref => ref.href), ["one.png", "two words.svg", "three\\(x\\).png", "four.png", "four.png"]);
  const markup = '[![Diagram](diagram.svg)](notes.md)', linked = imageReferences(markup)[0];
  assert.equal(linked.link, "notes.md"); assert.equal(markup.slice(linked.imageStart, linked.imageEnd), markup);
  assert.equal(imageReferences('\\![literal](nothing.png)').length, 0);
});

test("native Markdown image blocks retain reference links and repeated image references", async t => {
  const state = await runtime(t); await fixtures(state.dir);
  const { stageMarkdown } = await state.load("markdown.js");
  const result = await stageMarkdown('[Note][note]\n\n![Landscape][picture]\n\n![Again][picture]\n\n[note]: notes/next.markdown\n[picture]: landscape.png\n', { file: path.join(state.dir, "README.md"), on: null });
  assert.equal(result.blocks.filter(block => block.media).length, 2);
  assert.ok(result.blocks[0].text.includes('[note]: notes/next.markdown'));
  assert.equal(result.blocks[1].media.path, result.blocks[3].media.path);
  assert.equal(result.unavailable, false);
});

test("standalone tree opens Markdown, source, links, history, and ordinary text in place", async t => {
  const state = await runtime(t); await fixtures(state.dir);
  const panel = await state.start();
  const tree = state.render();
  assert.ok(find(tree, "preview-tree"));
  find(tree, "preview-file-README.md").handlers.on_click({}, state.cx); await state.settle();
  assert.equal(panel.selected.file, path.join(state.dir, "README.md"));
  assert.ok(panel.markdownBlocks.some(block => block.media?.path.startsWith("mods/preview-plus/.cache/")));
  const documentImage = find(state.render(), "preview-markdown-image-1");
  assert.equal(typeof documentImage.handlers.on_click, "function");
  documentImage.handlers.on_click({}, state.cx); await state.settle();
  assert.equal(panel.selected.file, path.join(state.dir, "landscape.png")); assert.equal(panel.history.length, 1);
  panel.back(state.cx); await state.settle();
  assert.equal(panel.code.readonly, true);
  const editor = panel.code;
  find(state.render(), "preview-source").handlers.on_click({}, state.cx);
  assert.equal(panel.source, true); assert.equal(panel.code, editor);
  panel.follow("notes/next.markdown", state.cx); await state.settle();
  assert.equal(panel.history.length, 1); assert.match(panel.text, /Linked note/);
  panel.back(state.cx); await state.settle(); assert.equal(panel.source, true);
  panel.follow("source.txt", state.cx); await state.settle(); assert.match(panel.code.value, /read-only/);
  panel.back(state.cx); await state.settle(); panel.back(state.cx);
  assert.equal(panel.selected, null); assert.ok(editor.released); assert.ok(find(state.render(), "preview-tree"));
});

test("paired mode follows per-space shared targets and returns to the configured tree", async t => {
  const state = await runtime(t); await fixtures(state.dir);
  state.props = { previewStack: "files" };
  state.shared["preview-plus.target"] = { s1: { file: path.join(state.dir, "source.txt"), root: state.dir, on: null } };
  const panel = await state.start(); assert.equal(panel.owner.mode, "paired");
  panel.back(state.cx);
  assert.deepEqual(JSON.parse(JSON.stringify(state.calls.at(-1))), { command: "layout.select", args: { stack: "files", child: "files-plus-tree" } });
  state.shared["preview-plus.target"].s1.file = path.join(state.dir, "notes/next.markdown");
  state.render(); await state.settle(); assert.match(panel.text, /Linked note/);
  state.focus = { ...state.focus, space: "s2" }; state.spaces = [{ id: "s2", active: true }];
  state.render(); assert.equal(panel.selected, null);
});

test("Back restores a PDF page and zoom after following a text link", async t => {
  const state = await runtime(t); await fixtures(state.dir); state.props = { file: path.join(state.dir, "guide.pdf") };
  const panel = await state.start(); panel.turnPage(1, state.cx); await state.settle(); panel.setZoom(1.5, state.cx);
  panel.follow("source.txt", state.cx); await state.settle(); assert.match(panel.code.value, /read-only/);
  panel.back(state.cx); assert.equal(find(state.render(), "preview-previous").handlers.on_click, undefined);
  await state.settle(); assert.equal(panel.media.page, 2); assert.equal(panel.zoom, 1.5);
  find(state.render(), "preview-previous").handlers.on_click({}, state.cx); await state.settle(); assert.equal(panel.media.page, 1);
});

test("Fit stays inside the measured viewport at non-default Herdr zoom", async t => {
  const state = await runtime(t); await fixtures(state.dir); state.props = { file: path.join(state.dir, "landscape.png") }; state.zoom = 1.2;
  const panel = await state.start();
  panel.measure({ width: 480, height: 360 }, state.cx);
  const canvas = find(state.render(), "preview-media"), content = canvas.nodes[0], image = content.nodes[0];
  assert.ok(image.attributes.w[0] * state.zoom + 32 * state.zoom <= 480);
  assert.ok(image.attributes.h[0] * state.zoom + 32 * state.zoom <= 360);
  assert.equal(image.attributes.w[0] / image.attributes.h[0], 640 / 400);
});

test("old async reads cannot replace a newer target, including an A-B-A sequence", async t => {
  const state = await runtime(t); state.props = { file: path.join(state.dir, "a.txt") };
  const pending = [];
  state.hooks.read = file => new Promise(resolve => pending.push({ file, resolve }));
  const { default: Panel } = await state.load("main.js"), panel = state.panel = new Panel(); panel.init({}, state.cx);
  await new Promise(resolve => setImmediate(resolve));
  state.props.file = path.join(state.dir, "b.txt"); state.render(); await new Promise(resolve => setImmediate(resolve));
  state.props.file = path.join(state.dir, "a.txt"); state.render(); await new Promise(resolve => setImmediate(resolve));
  pending[2].resolve("current A"); await state.settle();
  pending[0].resolve("stale A"); pending[1].resolve("stale B"); await new Promise(resolve => setImmediate(resolve));
  assert.equal(panel.code.value, "current A"); assert.equal(panel.history.length, 0);
});

test("missing, binary, unreadable and truncated text produce bounded observable states", async t => {
  const state = await runtime(t); state.props = { file: path.join(state.dir, "missing.txt") };
  const panel = await state.start(); assert.match(panel.error, /no longer available/);
  await fs.writeFile(state.props.file, "binary\0value"); panel.reload(state.cx); await state.settle(); assert.match(panel.error, /binary/);
  state.hooks.read = async () => { throw new Error("Permission denied"); }; panel.reload(state.cx); await state.settle(); assert.match(panel.error, /Permission denied/);
  state.hooks.read = async () => "x".repeat(400100); panel.reload(state.cx); await state.settle();
  assert.ok(panel.code.value.length < 400100); assert.match(panel.code.value, /truncated/); assert.equal(panel.error, null);
});

test("out-of-order PDF conversions cannot overwrite the selected page or a new space", async t => {
  const state = await runtime(t); state.props = { previewStack: "files" };
  state.shared["preview-plus.target"] = { s1: { file: path.join(state.dir, "guide.pdf"), on: null } };
  const pending = [];
  state.hooks.exec = async command => command === "osascript" ? new Promise(resolve => pending.push(resolve)) : undefined;
  const { default: Panel } = await state.load("main.js"), panel = state.panel = new Panel(); panel.init({}, state.cx);
  await new Promise(resolve => setImmediate(resolve));
  const result = page => ({ code: 0, stdout: JSON.stringify({ path: `mods/preview-plus/.cache/page-${page}.png`, width: 600, height: 800, pages: 3, page }), stderr: "" });
  pending[0](result(1)); await state.settle();
  panel.turnPage(1, state.cx); await new Promise(resolve => setImmediate(resolve));
  panel.turnPage(1, state.cx); await new Promise(resolve => setImmediate(resolve));
  pending[2](result(3)); await state.settle(); pending[1](result(2)); await new Promise(resolve => setImmediate(resolve));
  assert.equal(panel.media.page, 3); assert.equal(panel.page, 3);
  panel.turnPage(-1, state.cx); await new Promise(resolve => setImmediate(resolve));
  state.focus = { ...state.focus, space: "s2" }; state.spaces = [{ id: "s2", active: true }]; state.render();
  pending[3](result(2)); await new Promise(resolve => setImmediate(resolve)); assert.equal(panel.selected, null); assert.equal(panel.media, null);
});

test("watched source and Markdown image updates reload, unrelated files do not", async t => {
  const state = await runtime(t); await fixtures(state.dir); state.props = { file: path.join(state.dir, "README.md") };
  const panel = await state.start(), first = panel.markdownBlocks.find(block => block.media).media.path, code = panel.code;
  await state.change(state.dir, [path.join(state.dir, "unrelated.txt")]); assert.equal(panel.code, code);
  await fs.writeFile(path.join(state.dir, "landscape.png"), png(640, 400, true));
  await state.change(state.dir, [path.join(state.dir, "landscape.png")]); assert.notEqual(panel.markdownBlocks.find(block => block.media).media.path, first);
  await fs.writeFile(state.props.file, "# Updated\n"); await state.change(state.dir, [state.props.file]); assert.equal(panel.text, "# Updated\n");
  await fs.rm(state.props.file); await state.change(state.dir, [state.props.file]); assert.match(panel.error, /no longer available/);
});

test("remote text retains its machine; remote media explains the unsupported state", async t => {
  const state = await runtime(t); state.props = { file: "/remote/start.md", on: "server" };
  let options;
  state.hooks.read = async (_file, value) => { options = value; return "# Remote\n\n![image](photo.png)"; };
  const panel = await state.start(); assert.equal(options.on, "server"); assert.equal(panel.imageWarning, true);
  panel.follow("photo.png", state.cx); await state.settle(); assert.equal(panel.selected.on, "server"); assert.match(panel.error, /only available for local/);
  assert.equal(state.calls.filter(call => call.command === "osascript").length, 0);
  assert.equal(find(state.render(), "preview-open").handlers.on_click, undefined);
});

test("native physical-path events refresh a source opened through a symlink alias", async t => {
  const state = await runtime(t); await fixtures(state.dir);
  state.props = { file: path.join(state.dir, "source.txt") };
  const panel = await state.start(), physical = await fs.realpath(state.props.file);
  await fs.writeFile(state.props.file, "Updated through a physical path event.\n");
  await state.change(state.dir, [physical]); assert.match(panel.text, /physical path event/);
});

test("HTTP links use the browser and preserve the current preview history", async t => {
  const state = await runtime(t); await fixtures(state.dir); state.props = { file: path.join(state.dir, "source.txt") };
  const panel = await state.start(); panel.follow("https://herdr.dev", state.cx);
  assert.deepEqual(state.calls.at(-1), { command: "open_url", url: "https://herdr.dev" }); assert.equal(panel.history.length, 0);
});

test("native image staging preserves dimensions, quotes, cache freshness, and content", { skip: process.platform !== "darwin" }, async t => {
  const state = await runtime(t); await fixtures(state.dir);
  const { loadMedia } = await state.load("media.js"), file = path.join(state.dir, "a 'quoted' landscape.png");
  await fs.copyFile(path.join(state.dir, "landscape.png"), file);
  const first = await loadMedia({ file, on: null }); assert.equal(first.width, 640); assert.equal(first.height, 400);
  assert.deepEqual(await fs.readFile(path.join(state.dir, "app", first.path)), await fs.readFile(file));
  const again = await loadMedia({ file, on: null }); assert.equal(first.path, again.path);
  await fs.writeFile(file, png(640, 400, true)); const updated = await loadMedia({ file, on: null }); assert.notEqual(first.path, updated.path);
  const svg = await loadMedia({ file: path.join(state.dir, "diagram.svg"), on: null }); assert.equal(svg.width, 640); assert.equal(svg.height, 240);
});

test("PDFKit converts only the requested page and clamps after a document shrinks", { skip: process.platform !== "darwin" }, async t => {
  const state = await runtime(t); await fixtures(state.dir);
  const { loadMedia } = await state.load("media.js"), selected = { file: path.join(state.dir, "guide.pdf"), on: null };
  const first = await loadMedia(selected, 1, "pdf"); assert.equal(first.pages, 2); assert.equal(first.page, 1);
  let files = await fs.readdir(path.join(state.dir, "app/mods/preview-plus/.cache")); assert.equal(files.length, 1);
  const second = await loadMedia(selected, 2, "pdf"); assert.equal(second.page, 2); assert.notEqual(second.path, first.path);
  assert.ok(second.width > second.height); assert.ok(first.height > first.width);
  files = await fs.readdir(path.join(state.dir, "app/mods/preview-plus/.cache")); assert.equal(files.length, 2);
  await fs.writeFile(selected.file, pdf(1));
  const clamped = await loadMedia(selected, 2, "pdf"); assert.equal(clamped.page, 1); assert.equal(clamped.pages, 1);
});

test("Python fallback stages the same PNG/SVG without third-party modules", async t => {
  const state = await runtime(t); await fixtures(state.dir); state.platform = "linux";
  const { loadMedia } = await state.load("media.js");
  for (const name of ["landscape.png", "diagram.svg"]) {
    const media = await loadMedia({ file: path.join(state.dir, name), on: null }); assert.equal(media.width, 640);
    assert.ok((await fs.stat(path.join(state.dir, "app", media.path))).size > 0);
  }
  await assert.rejects(loadMedia({ file: path.join(state.dir, "guide.pdf"), on: null }, 1, "pdf"), /require macOS/);
});
