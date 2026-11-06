import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { runtime, find } from "./runtime.mjs";

test("the tree includes hidden names, omits .git, and never follows directory symlinks", async t => {
  const r = await runtime(t), w = await r.load("workspace.js");
  await fs.mkdir(path.join(r.dir, ".git"));
  await fs.mkdir(path.join(r.dir, "folder"));
  await fs.writeFile(path.join(r.dir, ".hidden"), "");
  await fs.writeFile(path.join(r.dir, "odd\nname.txt"), "");
  await fs.symlink("folder", path.join(r.dir, "link"));
  const list = Array.from(await w.directory(r.dir, null));
  assert.ok(!list.some(e => e.name === ".git"));
  assert.equal(list.find(e => e.name === "folder").dir, true);
  assert.equal(list.find(e => e.name === "link").dir, false);
  assert.ok(list.some(e => e.name === ".hidden"));
  assert.ok(list.some(e => e.name === "odd\nname.txt"));
});

test("single-folder text/Markdown previews are read-only, bounded and handle missing/binary files", async t => {
  const r = await runtime(t), { default: Files } = await r.load("main.js");
  r.shared["files-plus.open-location"] = "internal";
  const panel = new Files(); panel.init({}, r.cx); await r.drain();
  const file = path.join(r.dir, "README.md");
  await fs.writeFile(file, "# Heading\n"); panel.openFile(file, r.dir, r.cx); await r.drain();
  assert.equal(panel.code.value, "# Heading\n"); assert.equal(panel.code.readonly, true);
  assert.equal(panel.code.language, "markdown");
  assert.ok(find(panel.render(r.cx), "files-back"));
  await fs.writeFile(file, "x".repeat(400001)); panel.show(file, r.cx); await r.drain();
  assert.ok(panel.code.value.startsWith("x".repeat(400000))); assert.match(panel.code.value.slice(400000), /truncated/);
  await fs.writeFile(file, "a\0b"); panel.show(file, r.cx); await r.drain(); assert.match(panel.fileError, /Binary file/);
  await fs.unlink(file); panel.show(file, r.cx); await r.drain(); assert.match(panel.fileError, /no longer available/);
  panel.close();
});

test("workspace focus changes retain expansion and preview; paired mode sends the owning root", async t => {
  const r = await runtime(t), { default: Files } = await r.load("main.js");
  r.shared["files-plus.open-location"] = "internal";
  const web = path.join(r.dir, "web"), api = path.join(r.dir, "api");
  await fs.mkdir(path.join(web, "src"), { recursive: true }); await fs.mkdir(api);
  const file = path.join(web, "README.md"); await fs.writeFile(file, "# Web\n");
  r.shared["multi-root.spaces"] = { s1: { name: "Product", file: null, folders: [{ path: web }, { path: api }] } };
  r.focus.cwd = web;
  const panel = new Files(); panel.init({}, r.cx); await r.drain();
  panel.toggle(path.join(web, "src"), r.cx); panel.show(file, r.cx); await r.drain();
  r.focus.cwd = api; r.panes[0].cwd = api;
  panel.render(r.cx); await r.drain();
  assert.equal(panel.file, file); assert.ok(panel.folders.has(path.join(web, "src")));
  find(panel.render(r.cx), "files-back").handlers.on_click({}, r.cx);
  assert.ok(find(panel.render(r.cx), `root-${api}`));
  await fs.mkdir(path.join(r.dir, "app/mods/preview-plus"), { recursive: true });
  await fs.writeFile(path.join(r.dir, "app/mods/preview-plus/mod.json"), "{}");
  r.props.previewStack = "files"; panel.show(null); panel.openFile(file, web, r.cx); await r.drain();
  assert.deepEqual(JSON.parse(JSON.stringify(r.shared["preview-plus.target"].s1)), { file, root: web, on: null });
  assert.deepEqual(JSON.parse(JSON.stringify(r.calls.at(-1))), { command: "layout.select", args: { stack: "files", child: "preview-plus" } });
  assert.equal(panel.file, null); assert.ok(panel.folders.has(path.join(web, "src")));
});

test("configured pairing falls back to source when Preview Plus is absent", async t => {
  const r = await runtime(t), { default: Files } = await r.load("main.js");
  r.shared["files-plus.open-location"] = "internal";
  r.props.previewStack = "files";
  const file = path.join(r.dir, "README.md"); await fs.writeFile(file, "# Alone\n");
  const panel = new Files(); panel.init({}, r.cx); await r.drain();
  panel.openFile(file, r.dir, r.cx); await r.drain();
  assert.equal(panel.code.value, "# Alone\n"); assert.equal(r.shared["preview-plus.target"], undefined);
});

test("stale preview reads cannot replace the latest file or another space", async t => {
  const r = await runtime(t), { default: Files } = await r.load("main.js");
  const file = path.join(r.dir, "a.txt"), next = path.join(r.dir, "b.txt");
  await fs.writeFile(file, "A"); await fs.writeFile(next, "B");
  const panel = new Files(); panel.init({}, r.cx); await r.drain();
  panel.show(file, r.cx); panel.show(next, r.cx); await r.drain();
  assert.equal(panel.code.value, "B");
  panel.show(file, r.cx); r.spaces[0].active = false; panel.render(r.cx); await r.drain();
  assert.equal(panel.file, null); assert.equal(panel.code, null);
});

test("refresh preserves an unchanged editor and reloads changed preview bytes", async t => {
  const r = await runtime(t), { default: Files } = await r.load("main.js");
  const file = path.join(r.dir, "a.txt"); await fs.writeFile(file, "A");
  const panel = new Files(); panel.init({}, r.cx); await r.drain();
  panel.show(file, r.cx); await r.drain(); const first = panel.code;
  panel.refresh(r.cx); await r.drain(); assert.equal(panel.code, first);
  await fs.writeFile(file, "changed"); panel.refresh(r.cx); await r.drain();
  assert.equal(panel.code.value, "changed"); assert.equal(first.released, true);
});

test("a delayed preview handoff cannot replace a later text selection", async t => {
  const r = await runtime(t), { default: Files } = await r.load("main.js");
  r.shared["files-plus.open-location"] = "internal";
  await fs.mkdir(path.join(r.dir, "app/mods/preview-plus"), { recursive: true });
  await fs.writeFile(path.join(r.dir, "app/mods/preview-plus/mod.json"), "{}");
  const text = path.join(r.dir, "a.txt"); await fs.writeFile(text, "Latest");
  r.props.previewStack = "files";
  const panel = new Files(); panel.init({}, r.cx); await r.drain();
  let release, started;
  const pending = new Promise(resolve => { release = resolve; });
  const reading = new Promise(resolve => { started = resolve; });
  r.hooks.beforeRead = async file => { if (file.endsWith("preview-plus/mod.json")) { started(); await pending; } };
  panel.openFile(path.join(r.dir, "README.md"), r.dir, r.cx); await reading;
  panel.openFile(text, r.dir, r.cx); release(); await r.drain();
  assert.equal(r.shared["preview-plus.target"].s1.file, text);
  assert.equal(r.calls.filter(call => call.command === "layout.select").length, 1);
});

test("lazy loads share the 5,000 entry budget and cap every directory at 500", async t => {
  const r = await runtime(t), { default: Files } = await r.load("main.js");
  for (let group = 0; group < 11; group++) {
    const root = path.join(r.dir, `root-${group}`); await fs.mkdir(root);
    await Promise.all(Array.from({ length: 501 }, (_, n) => fs.writeFile(path.join(root, `${n}.txt`), "")));
  }
  r.shared["multi-root.spaces"] = { s1: { name: "Many", file: null, folders: Array.from({ length: 11 }, (_, group) => ({ path: path.join(r.dir, `root-${group}`) })) } };
  const panel = new Files(); panel.init({}, r.cx); await r.drain();
  const counts = [...panel.entries.values()].map(list => list.length);
  assert.ok(counts.every(n => n <= 500)); assert.equal(counts.reduce((a, b) => a + b, 0), 5000); assert.equal(panel.limited, true);
  for (const root of r.shared["multi-root.spaces"].s1.folders) panel.toggle(root.path, r.cx);
  assert.equal(panel.entryCount, 0); assert.equal(panel.limited, false);
});

test("popup navigation skips disabled actions and dialog cancellation does not mutate", async t => {
  const r = await runtime(t), { default: Files } = await r.load("main.js");
  r.props = { role: "menu", target: { ...r.target("file.txt"), active: null }, overlay: "menu1" };
  const menu = new Files(); menu.init({}, r.cx);
  assert.equal(menu.at, 1);
  const view = menu.render(r.cx);
  assert.equal(find(view, "action-agent").attributes.disabled[0], true);
  assert.equal(find(view, "action-paste").attributes.disabled[0], true);
  view.handlers.on_key_down({ key: "down" }, r.cx); assert.equal(menu.at, 3);
  view.handlers.on_key_down({ key: "enter" }, r.cx); await r.drain(); assert.equal(r.clipboard, r.props.target.path);
  r.props = { role: "dialog", action: "new-file", target: r.target("", "dir"), overlay: "dialog1" };
  const dialog = new Files(); dialog.init({}, r.cx);
  assert.equal(find(dialog.render(r.cx), "dialog-submit").attributes.disabled[0], true);
  find(dialog.render(r.cx), "dialog-cancel").handlers.on_click({}, r.cx);
  assert.equal(r.calls.at(-1).command, "closeOverlay");
  assert.deepEqual((await fs.readdir(r.dir)).sort(), ["home"]);
});

test("workspace root launch uses its captured space and root with an old launcher still installed", async t => {
  const r = await runtime(t), { default: Files } = await r.load("main.js"), { menuItems } = await r.load("actions.js");
  await fs.mkdir(path.join(r.dir, "app/mods/multi-root"), { recursive: true });
  await fs.writeFile(path.join(r.dir, "app/mods/multi-root/mod.json"), "{}");
  const root = path.join(r.dir, "api"), target = r.target("api", "root", root);
  r.props = { role: "menu", target, overlay: "menu1" };
  const menu = new Files(); menu.init({}, r.cx);
  const index = menuItems(target).findIndex(item => item.id === "new-here");
  assert.equal(find(menu.render(r.cx), "action-new-here").attributes.accessibility_label[0], "New terminal here");
  r.spaces.push({ id: "s2", machine: null, active: true }); r.spaces[0].active = false;
  r.focus = { space: "s2", cwd: "/elsewhere" };
  menu.choose(index, r.cx); await r.drain();
  assert.deepEqual(JSON.parse(JSON.stringify(r.calls)), [
    { command: "tab.new", args: { space: "s1", folder: root } },
    { command: "closeOverlay", id: "menu1" }
  ]);
});
