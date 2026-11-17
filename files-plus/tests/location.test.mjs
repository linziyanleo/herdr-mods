import { test } from "node:test";
import assert from "node:assert/strict";
import { runtime } from "./runtime.mjs";

async function setup(t) {
  const r = await runtime(t), { FilesPanel } = await r.load("workspace.js"), panel = new FilesPanel();
  r.spaces[0].folder = "/initial";
  const terminal = (cwd, space = "s1", address = "t1") => {
    r.focus = { space, pane: "terminal", terminal: address, cwd };
    r.panes = [{ pane: "terminal", terminal: address, cwd }];
  };
  const viewer = (mod = "third-party", space = "s1") => {
    r.focus = { space, pane: "viewer", terminal: null, cwd: null };
    r.panes = [{ pane: "viewer", mod, terminal: null, cwd: null }];
  };
  return { r, panel, terminal, viewer, FilesPanel };
}

test("third-party pane retains the most recently focused terminal cwd and key", async t => {
  const { panel, terminal, viewer } = await setup(t);
  terminal("/repo with spaces"); const before = panel.location();
  viewer(); assert.equal(panel.location().key, before.key);
  terminal("/newer"); panel.location(); viewer();
  assert.equal(panel.location().terminalCwd, "/newer");
});

test("space switches retain independent terminal folders, ignoring foreign focus", async t => {
  const { r, panel, terminal, viewer } = await setup(t);
  terminal("/repo-a"); panel.location();
  r.spaces.push({ id: "s2", folder: "/initial-b", machine: null, active: true }); r.spaces[0].active = false;
  assert.equal(panel.location().cwd, "/initial-b");
  terminal("/repo-b", "s2"); panel.location();
  r.spaces[0].active = true; r.spaces[1].active = false;
  viewer(); assert.equal(panel.location().cwd, "/repo-a");
  r.spaces[0].active = false; r.spaces[1].active = true;
  viewer("third-party", "s2"); assert.equal(panel.location().cwd, "/repo-b");
});

test("machine changes never reuse another machine's cwd, including paired preview", async t => {
  const { r, panel, terminal, viewer } = await setup(t);
  terminal("/local-repo"); panel.location();
  r.spaces[0].machine = "remote"; r.spaces[0].folder = "/remote-initial";
  viewer("preview-plus"); assert.equal(panel.location().cwd, "/remote-initial");
  terminal("/remote-repo", "s1", "remote/t1"); panel.location();
  viewer(); assert.equal(panel.location().cwd, "/remote-repo");
  r.spaces[0].machine = null; r.spaces[0].folder = "/initial";
  assert.equal(panel.location().cwd, "/initial");
});

test("a terminal block's cwd and host stay together across neutral and paired panes", async t => {
  const { r, panel, terminal, viewer } = await setup(t);
  terminal("/local-repo"); panel.location();
  r.focus = { space: "s1", pane: null, terminal: "remote/t8", cwd: "/remote-repo" };
  assert.equal(panel.location().on, "remote");
  for (const mod of ["third-party", "preview-plus"]) {
    viewer(mod); const loc = panel.location();
    assert.equal(loc.on, "remote"); assert.equal(loc.cwd, "/remote-repo");
  }
  terminal("/local-again"); assert.equal(panel.location().on, null);
  viewer(); assert.equal(panel.location().cwd, "/local-again");
  // Local terminal blocks in a remote space must likewise keep explicit null on.
  r.spaces[0].machine = "remote";
  r.focus = { space: "s1", pane: null, terminal: "t8", cwd: "/local-block" };
  panel.location(); viewer();
  assert.equal(panel.location().on, null); assert.equal(panel.location().cwd, "/local-block");
});

test("manual browsing wins without overwriting the terminal fallback or workspace mapping", async t => {
  const { r, panel, terminal, viewer } = await setup(t);
  const { setBrowsingFolder } = await r.load("browsing.js");
  terminal("/repo"); panel.location(); setBrowsingFolder("s1", null, "/browse");
  terminal("/new-repo"); assert.equal(panel.location().cwd, "/browse");
  viewer(); assert.equal(panel.location().terminalCwd, "/new-repo");
  setBrowsingFolder("s1", null, null); assert.equal(panel.location().cwd, "/new-repo");
  assert.equal(r.shared["multi-root.spaces"], undefined);
});

test("paired preview and pin state remain untouched by third-party focus fallback", async t => {
  const { r, panel, terminal, viewer } = await setup(t);
  const pin = { s1: { file: "/repo/pinned.md", on: null } };
  r.shared["preview-plus.pinned"] = pin;
  terminal("/repo"); panel.location();
  for (const mod of ["files-plus", "preview-plus", "third-party"]) {
    viewer(mod); assert.equal(panel.location().cwd, "/repo");
  }
  assert.equal(r.shared["preview-plus.pinned"], pin); assert.equal(r.calls.length, 0);
});

test("cold copies do not resurrect an old cwd or infer one from an unfocused terminal", async t => {
  const { r, panel, terminal, viewer, FilesPanel } = await setup(t);
  terminal("/deleted-repo"); panel.location(); viewer();
  r.panes.push({ pane: "other", terminal: "t2", cwd: "/unfocused" });
  assert.equal(new FilesPanel().location().cwd, "/initial");
  assert.equal(r.shared["files-plus.last-terminal-cwd"], undefined);
});

test("removed spaces forget their terminal fallback", async t => {
  const { r, panel, terminal, viewer } = await setup(t);
  terminal("/old"); panel.location(); const space = r.spaces[0];
  r.spaces = []; r.focus = null; assert.equal(panel.location().cwd, undefined);
  r.spaces = [space]; viewer(); assert.equal(panel.location().cwd, "/initial");
});


test("unresolved focus and cwd-less terminals cannot inherit a different host", async t => {
  const { r, panel, viewer } = await setup(t);
  r.focus = { space: "s1", pane: null, terminal: "remote/t8", cwd: "/remote-repo" };
  panel.location();
  r.focus = null; assert.equal(panel.location().on, null); assert.equal(panel.location().cwd, "/initial");
  viewer(); assert.equal(panel.location().cwd, "/remote-repo");
  r.focus = { space: "s1", pane: null, terminal: "other/t9", cwd: null };
  const missing = panel.location(); assert.equal(missing.on, "other"); assert.equal(missing.cwd, undefined);
});

test("explicit workspace roots and saved mapping survive neutral focus", async t => {
  const { r, panel, terminal, viewer } = await setup(t);
  const mapping = { s1: { name: "Roots", file: null, folders: [{ path: "/one" }, { path: "/two" }] } };
  r.shared["multi-root.spaces"] = mapping;
  terminal("/two/sub"); const before = panel.location(); viewer(); const after = panel.location();
  assert.equal(after.key, before.key); assert.equal(after.entry, before.entry);
  assert.equal(r.shared["multi-root.spaces"], mapping);
});


test("transient missing focus does not overwrite remembered cwd before paired preview", async t => {
  const { r, panel, terminal, viewer } = await setup(t);
  terminal("/repo"); panel.location();
  r.focus = null; assert.equal(panel.location().cwd, "/initial");
  viewer("preview-plus"); assert.equal(panel.location().cwd, "/repo");
});
