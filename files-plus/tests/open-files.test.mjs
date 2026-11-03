import { test } from "node:test";
import assert from "node:assert/strict";
import { runtime } from "./runtime.mjs";

function fixture(r, { file = r.dir + "/code.ts", on = null, mod = "files-plus", space = "s1", tab = "open-tab", pane = "open-pane" } = {}) {
  const prefix = on ? on + "/" : "", spaceId = prefix + space, tabId = prefix + tab;
  let liveSpace = r.spaces.find(value => value.id === spaceId);
  if (!liveSpace) { liveSpace = { id: spaceId, machine: on, tabs: [] }; r.spaces.push(liveSpace); }
  liveSpace.tabs.push({ id: tabId });
  r.panes.push({ pane: prefix + pane, mod, tab: tabId });
  const node = { id: pane, type: "block", content: { mod, props: { file, on, ...(mod === "files-plus" ? { role: "preview" } : {}) } } };
  return { id: space, tabs: [{ id: tab, root: { id: "split", type: "row", children: [node] } }] };
}

function document(r, spaces) {
  r.hooks.exec = async (command, args) => {
    if (!args.some(arg => typeof arg === "string" && arg.includes("hc connect"))) return;
    const query = JSON.parse(args.at(-1));
    assert.equal(query.method, "doc.get"); assert.equal(query.params.name, "herdr-app");
    return { code: 0, stdout: JSON.stringify({ id: query.id, result: { value: { spaces }, version: 7 } }), stderr: "" };
  };
}

test("repeated clicks reuse an existing source Tab even after changing opening preferences", async t => {
  const r = await runtime(t), { default: Files } = await r.load("main.js");
  const panel = new Files(); panel.init({}, r.cx); await r.drain();
  document(r, [fixture(r)]);
  for (const destination of ["tab", "pane", "internal"]) {
    r.focus = { space: "s1", pane: "p1", tab: "tab1", cwd: r.dir };
    r.shared["files-plus.open-location"] = destination; r.calls = [];
    panel.openFile(r.dir + "/code.ts", r.dir, r.cx); await r.drain();
    assert.deepEqual(r.calls.filter(call => ["space.select", "tab.select", "pane.focus"].includes(call.command)).map(call => [call.command, call.args.id || call.args.pane]),
      [["space.select", "s1"], ["tab.select", "open-tab"], ["pane.focus", "open-pane"]]);
    assert.equal(r.calls.some(call => ["tab.new", "pane.split"].includes(call.command)), false);
  }
});

test("a Preview Plus split in another space is focused and revealed from behind a zoomed sibling", async t => {
  const r = await runtime(t), { default: Files } = await r.load("main.js");
  const panel = new Files(); panel.init({}, r.cx); await r.drain();
  document(r, [fixture(r, { file: r.dir + "/manual.pdf", mod: "preview-plus", space: "s2" })]);
  r.panes.push({ pane: "zoomed-sibling", tab: "open-tab", zoomed: true });
  panel.openFile(r.dir + "/manual.pdf", r.dir, r.cx); await r.drain();
  assert.equal(r.calls.find(call => call.command === "space.select").args.id, "s2");
  assert.equal(r.calls.find(call => call.command === "pane.zoom").args.pane, "zoomed-sibling");
  assert.equal(r.calls.at(-1).args.pane, "open-pane");
  assert.equal(r.calls.some(call => ["tab.new", "pane.split"].includes(call.command)), false);
});

test("matching uses full normalized paths and machine identity, rejects stale panes and prefers the current space", async t => {
  const r = await runtime(t), { findOpenFile } = await r.load("open-files.js");
  const first = fixture(r, { space: "s2", tab: "first", pane: "first-pane" });
  const current = fixture(r, { file: r.dir + "/nested/../code.ts" });
  document(r, [first, current]);
  assert.equal((await findOpenFile(r.dir + "/code.ts", null, "s1")).pane, "open-pane");
  assert.equal(await findOpenFile(r.dir + "/other/code.ts", null, "s1"), null);
  document(r, [fixture(r, { file: r.dir + "/a\\b.ts", tab: "backslash", pane: "backslash-pane" })]);
  assert.equal(await findOpenFile(r.dir + "/a/b.ts", null, "s1"), null);
  document(r, [first, current]);
  r.panes = r.panes.filter(pane => pane.pane !== "open-pane");
  assert.equal((await findOpenFile(r.dir + "/code.ts", null, "s1")).pane, "first-pane");
  r.spaces = r.spaces.filter(space => space.id !== "s2");
  assert.equal(await findOpenFile(r.dir + "/code.ts", null, "s1"), null);
  const remote = fixture(r, { on: "server", file: "/repo/code.ts" });
  document(r, [remote]);
  assert.deepEqual(JSON.parse(JSON.stringify(await findOpenFile("/repo/code.ts", "server", "server/s1"))),
    { space: "server/s1", tab: "server/open-tab", pane: "server/open-pane" });
  assert.equal(await findOpenFile("/repo/code.ts", null, "s1"), null);
  r.platform = "windows";
  document(r, [fixture(r, { file: "C:\\repo\\code.ts", tab: "windows", pane: "windows-pane" })]);
  assert.equal((await findOpenFile("c:/repo/code.ts", null, "s1")).pane, "windows-pane");
});

test("lookup failure reports an error instead of creating a duplicate", async t => {
  const r = await runtime(t), { default: Files } = await r.load("main.js");
  const panel = new Files(); panel.init({}, r.cx); await r.drain();
  fixture(r);
  r.hooks.exec = async () => ({ code: 1, stdout: "", stderr: "unavailable" });
  panel.openFile(r.dir + "/code.ts", r.dir, r.cx); await r.drain();
  assert.equal(r.calls.at(-1).command, "notify");
  assert.equal(r.calls.some(call => ["tab.new", "pane.split", "pane.focus"].includes(call.command)), false);
});

test("an old lookup cannot steal focus from a newer click", async t => {
  const r = await runtime(t), { default: Files } = await r.load("main.js");
  const panel = new Files(); panel.init({}, r.cx); await r.drain();
  const space = fixture(r);
  let release, started, count = 0;
  const pending = new Promise(resolve => { release = resolve; });
  const reading = new Promise(resolve => { started = resolve; });
  r.hooks.exec = async (_command, args) => {
    if (!args.some(arg => typeof arg === "string" && arg.includes("hc connect"))) return;
    if (++count === 1) { started(); await pending; }
    return { code: 0, stdout: JSON.stringify({ id: "files-plus-open", result: { value: { spaces: [space] } } }) };
  };
  panel.openFile(r.dir + "/code.ts", r.dir, r.cx); await reading;
  panel.openFile(r.dir + "/other.ts", r.dir, r.cx); release(); await r.drain();
  assert.equal(r.calls.some(call => call.command === "pane.focus"), false);
  const opens = r.calls.filter(call => call.command === "tab.new");
  assert.equal(opens.length, 1); assert.equal(opens[0].args.props.file, r.dir + "/other.ts");
});
