import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { runtime, find } from "./runtime.mjs";

async function setup(t) {
  const r = await runtime(t), { default: Files } = await r.load("main.js");
  const panel = new Files(); panel.init({}, r.cx); await r.drain();
  r.picked = path.join(r.dir, "other"); await fs.mkdir(r.picked);
  return { r, panel };
}

test("browse a separate folder, retain terminal cwd, then restore following", async t => {
  const { r, panel } = await setup(t), original = JSON.stringify([r.spaces, r.panes]);
  find(panel.render(r.cx), "change-folder").handlers.on_click({}, r.cx); await r.drain();
  assert.equal(panel.root, r.picked);
  assert.equal(JSON.stringify([r.spaces, r.panes]), original);
  assert.equal(r.shared["multi-root.spaces"], undefined);
  r.focus.cwd = r.dir + "/next"; r.panes[0].cwd = r.focus.cwd;
  assert.equal(panel.location().cwd, r.picked);
  find(panel.render(r.cx), "use-terminal-folder").handlers.on_click({}, r.cx); await r.drain();
  assert.equal(panel.root, r.focus.cwd);
  assert.equal(r.shared["files-plus.browsing"].s1, undefined);
});

test("workspace override does not change mapping and restores all roots", async t => {
  const { r, panel } = await setup(t);
  r.shared["multi-root.spaces"] = { s1: { name: "Work", file: null, folders: [{ path: r.dir }, { path: r.picked }] } };
  const before = JSON.stringify(r.shared["multi-root.spaces"]);
  panel.refresh(r.cx); await r.drain();
  panel.changeFolder(r.cx); await r.drain();
  assert.equal(panel.workspace, null); assert.equal(panel.root, r.picked);
  assert.equal(JSON.stringify(r.shared["multi-root.spaces"]), before);
  assert.equal(find(panel.render(r.cx), "use-terminal-folder").attributes.accessibility_label[0], "Use workspace folders");
  panel.useDefaultFolder(r.cx); await r.drain();
  assert.equal(panel.workspace.folders.length, 2);
});

test("cancel, closed spaces, repeated clicks and disposed views cannot apply a picker", async t => {
  const { r, panel } = await setup(t);
  r.picked = null; panel.changeFolder(r.cx); await r.drain();
  assert.equal(r.shared["files-plus.browsing"], undefined);
  r.picked = r.dir; panel.changeFolder(r.cx); panel.changeFolder(r.cx);
  assert.equal(r.tasks.length, 1); panel.close(); await r.drain();
  assert.equal(r.shared["files-plus.browsing"], undefined);
  const { setBrowsingFolder } = await r.load("browsing.js"); r.spaces = [];
  assert.equal(setBrowsingFolder("s1", null, r.dir), false);
});

test("overrides are scoped to space and machine, and remote picker stays disabled", async t => {
  const { r, panel } = await setup(t);
  panel.changeFolder(r.cx); await r.drain();
  r.spaces[0].machine = "remote";
  assert.equal(panel.location().browsing, null);
  const button = find(panel.render(r.cx), "change-folder"); assert.equal(button.attributes.disabled[0], true);
  panel.changeFolder(r.cx); assert.equal(panel.folderPicker, null);
  r.spaces[0].machine = null; r.spaces[0].active = false;
  r.spaces.push({ id: "s2", folder: r.dir, active: true, machine: null });
  assert.equal(panel.location().browsing, null);
});

test("picker captures original space even when focus changes", async t => {
  const { r, panel } = await setup(t);
  panel.changeFolder(r.cx);
  r.spaces[0].active = false; r.spaces.push({ id: "s2", folder: r.dir, active: true, machine: null });
  await r.drain();
  assert.equal(r.shared["files-plus.browsing"].s1.path, r.picked);
  assert.equal(r.shared["files-plus.browsing"].s2, undefined);
  assert.equal(panel.spaceId, "s2");
});

test("Add folder continues to target the terminal root while browsing elsewhere", async t => {
  const { r, panel } = await setup(t);
  panel.changeFolder(r.cx); await r.drain();
  find(panel.render(r.cx), "add-folder").handlers.on_click({}, r.cx);
  const overlay = r.calls.findLast(c => c.command === "openOverlay");
  assert.equal(overlay.spec.props.target.root, r.dir);
});

test("preview focus retains terminal location independently of the browsing root", async t => {
  const { r, panel } = await setup(t);
  panel.changeFolder(r.cx); await r.drain();
  r.panes = [{ pane: "preview", mod: "preview-plus" }];
  r.focus = { space: "s1", pane: "preview", cwd: null };
  assert.equal(panel.location().terminalCwd, r.dir);
  panel.useDefaultFolder(r.cx); await r.drain();
  assert.equal(panel.root, r.dir);
});
