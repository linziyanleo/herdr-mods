import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { runtime, find } from "./runtime.mjs";

test("folder title and trailing settings button expose persisted open locations", async t => {
  const r = await runtime(t), { default: Files } = await r.load("main.js");
  const panel = new Files(); panel.init({}, r.cx); await r.drain();
  const view = panel.render(r.cx);
  assert.deepEqual(find(view, "files-title").nodes, [path.basename(r.dir)]);
  find(view, "files-settings").handlers.on_click({}, r.cx);
  const spec = r.calls.at(-1).spec;
  assert.equal(spec.kind, "dialog"); assert.equal(spec.props.role, "settings");
  r.props = { ...spec.props, overlay: "settings" };
  const dialog = new Files(); dialog.init({}, r.cx);
  assert.equal(find(dialog.render(r.cx), "open-tab").attributes.checked[0], true);
  find(dialog.render(r.cx), "open-pane").handlers.on_click({}, r.cx);
  const reopened = new Files(); reopened.init({}, r.cx);
  assert.equal(find(reopened.render(r.cx), "open-pane").attributes.checked[0], true);
  reopened.render(r.cx).handlers.on_key_down({ key: "down" }, r.cx);
  assert.equal(r.shared["files-plus.open-location"], "internal");
  find(reopened.render(r.cx), "settings-done").handlers.on_click({}, r.cx);
  assert.equal(r.calls.at(-1).id, "settings");
});

test("default and invalid preferences open a source Tab; Pane targets the captured pane", async t => {
  const r = await runtime(t), { default: Files } = await r.load("main.js");
  const panel = new Files(); panel.init({}, r.cx); await r.drain();
  const file = path.join(r.dir, "code.ts");
  for (const preference of [undefined, "invalid", "pane"]) {
    r.shared["files-plus.open-location"] = preference;
    panel.openFile(file, r.dir, r.cx); await r.drain();
    const call = r.calls.at(-1);
    assert.equal(call.command, preference === "pane" ? "pane.split" : "tab.new");
    assert.equal(call.args.mod, "files-plus"); assert.equal(call.args.props.role, "preview");
    assert.equal(call.args.props.file, file);
    if (preference === "pane") assert.equal(call.args.pane, "p1");
    else { assert.equal(call.args.space, "s1"); assert.equal(call.args.name, "code.ts"); }
    assert.ok(!panel.file);
  }
  r.focus.pane = null;
  panel.openFile(file, r.dir, r.cx); await r.drain();
  assert.equal(r.calls.at(-1).command, "notify");
});

test("rich Tabs and Panes use Preview Plus without a sidebar stack", async t => {
  const r = await runtime(t), { default: Files } = await r.load("main.js");
  await fs.mkdir(path.join(r.dir, "app/mods/preview-plus"), { recursive: true });
  await fs.writeFile(path.join(r.dir, "app/mods/preview-plus/mod.json"), "{}");
  const panel = new Files(); panel.init({}, r.cx); await r.drain();
  for (const preference of ["tab", "pane"]) {
    r.shared["files-plus.open-location"] = preference;
    panel.openFile(path.join(r.dir, "README.md"), r.dir, r.cx); await r.drain();
    assert.equal(r.calls.at(-1).args.mod, "preview-plus");
    assert.equal(r.calls.at(-1).args.props.root, r.dir);
    assert.equal(r.shared["preview-plus.target"], undefined);
  }
});

test("standalone source preview stays on its captured file across focus changes", async t => {
  const r = await runtime(t), { default: Files } = await r.load("main.js");
  const file = path.join(r.dir, "code.ts"); await fs.writeFile(file, "export const value = 1;");
  r.props = { role: "preview", file, root: r.dir, on: null };
  const preview = new Files(); preview.init({}, r.cx); await r.drain();
  assert.equal(preview.code.readonly, true);
  assert.equal(preview.code.value, "export const value = 1;");
  r.focus = { space: "elsewhere", cwd: "/other" }; r.spaces[0].active = false;
  await fs.writeFile(file, "changed");
  r.timers.find(timer => timer.ms === 10000).fn(r.cx); await r.drain();
  assert.equal(preview.code.value, "changed");
  assert.ok(find(preview.render(r.cx), "file-viewer"));
  assert.equal(find(preview.render(r.cx), "files-back"), null);
  preview.close(); assert.equal(preview.code.released, true);
});

test("opening a preview keeps the sidebar directory and expansion until a terminal changes it", async t => {
  const r = await runtime(t), { default: Files } = await r.load("main.js");
  const folder = path.join(r.dir, "nested"); await fs.mkdir(folder);
  r.focus.cwd = folder; r.panes[0].cwd = folder;
  const panel = new Files(); panel.init({}, r.cx); await r.drain();
  r.panes.push({ pane: "preview", mod: "files-plus", tab: "preview-tab", cwd: null, terminal: null });
  r.focus = { space: "s1", tab: "preview-tab", pane: "preview", cwd: null };
  panel.render(r.cx); await r.drain();
  assert.equal(panel.root, folder);
  assert.deepEqual(find(panel.render(r.cx), "files-title").nodes, ["nested"]);
  r.focus = { space: "s1", tab: "tab1", pane: "p1", cwd: r.dir }; r.panes[0].cwd = r.dir;
  panel.render(r.cx); await r.drain(); assert.equal(panel.root, r.dir);
});
