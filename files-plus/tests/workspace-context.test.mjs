import { test } from "node:test";
import assert from "node:assert/strict";
import { runtime, find } from "./runtime.mjs";

async function fixture(t) {
  const r = await runtime(t), { default: FilesPlus } = await r.load("main.js");
  const roots = [r.dir, `${r.dir}/API "draft"`];
  const entry = { file: null, folders: roots.map(path => ({ path })) };
  r.shared["multi-root.spaces"] = { s1: entry };
  r.agents = [{ address: "t1", space: "s1", tab: "tab1", status: "idle", app: "codex" }];
  r.terminals = [{ address: "t1", state: "live", created_ms: 1 }];
  r.panes[0].program = { agent: true };
  const panel = new FilesPlus();
  panel.init({}, r.cx);
  await r.drain();
  r.calls = [];

  function open(kind = "root") {
    panel.menu(kind === "root" ? roots[0] : `${roots[0]}/README.md`, kind, roots[0], { position: { x: 20, y: 20 } }, r.cx);
    r.props = { ...JSON.parse(JSON.stringify(r.calls.at(-1).spec.props)), overlay: "menu" };
    const menu = new FilesPlus();
    menu.init({}, r.cx);
    const view = menu.render(r.cx);
    return { menu, view, action: find(view, "action-workspace-context"), reference: find(view, "action-agent") };
  }
  return { r, entry, roots, panel, open };
}

test("an explicit root menu action pastes one editable line into the captured agent", async t => {
  const { r, roots, panel, open } = await fixture(t);
  panel.render(r.cx); panel.render(r.cx);
  const { action, reference } = open();
  assert.ok(action && reference);
  assert.equal(r.pasted, undefined);
  assert.deepEqual(r.calls.map(call => call.command), ["openOverlay"]);

  action.handlers.on_click({}, r.cx);
  await r.drain();
  assert.equal(r.pasted, `This session is in a multi-root workspace with these root directories: ${roots.map(path => JSON.stringify(path)).join(", ")}. Check each listed root for applicable harness or instruction files.`);
  assert.doesNotMatch(r.pasted, /[\r\n]/);
  assert.equal(r.clipboard, "original clipboard");
  assert.deepEqual(r.calls.map(call => call.command), ["openOverlay", "pane.focus", "terminal.paste", "closeOverlay"]);
  assert.equal(r.calls[1].args.terminal, "t1");
  assert.equal(open("file").action, null);
});

test("only a declared multi-root workspace with a clear and ready agent offers the action", async t => {
  const changes = {
    "ordinary folder": ({ r }) => { delete r.shared["multi-root.spaces"].s1; },
    "duplicate single root": ({ entry }) => { entry.folders = [entry.folders[0], entry.folders[0]]; },
    "invalid config": ({ entry }) => { entry.error = "Invalid workspace JSON"; },
    "control characters in path": ({ entry }) => { entry.folders[1].path += "\r"; },
    "browse override": ({ r }) => { r.shared["files-plus.browsing"] = { s1: { on: null, path: r.dir } }; },
    "ordinary shell": ({ r }) => { r.agents = []; },
    "working agent": ({ r }) => { r.agents[0].status = "working"; },
    "blocked agent": ({ r }) => { r.agents[0].status = "blocked"; },
    "ambiguous agents while Files has focus": ({ r }) => {
      r.focus = { space: "s1", tab: "tab1", terminal: null };
      r.agents.push({ ...r.agents[0], address: "t2" });
    },
    "other tab": ({ r }) => { r.agents[0].tab = "tab2"; },
    "other space": ({ r }) => { r.agents[0].space = "s2"; },
    "other machine": ({ r }) => { r.focus.terminal = "remote/t1"; },
    "disconnected terminal": ({ r }) => { r.terminals[0].state = "finished"; }
  };
  for (const [scenario, change] of Object.entries(changes)) await t.test(scenario, async t => {
    const setup = await fixture(t);
    change(setup);
    const { action, reference } = setup.open();
    assert.equal(action, null);
    assert.ok(reference);
  });
});

test("the root paste stops if its captured menu, workspace or terminal changes", async t => {
  const changes = {
    "menu closed while focus was queued": ({ menu }) => menu.close(),
    "space switched": ({ r }) => { r.spaces[0].active = false; },
    "tab switched": ({ r }) => { r.spaces[0].tabs[0].active = false; },
    "machine switched": ({ r }) => { r.spaces[0].machine = "remote"; },
    "workspace roots changed": ({ entry }) => { entry.folders[1].path += "-new"; },
    "agent began working": ({ r }) => { r.agents[0].status = "working"; },
    "agent was replaced in the same terminal": ({ r }) => { r.agents[0].app = "other-agent"; },
    "terminal ID was reused": ({ r }) => { r.terminals[0].created_ms++; },
    "terminal closed": ({ r }) => { r.terminals = []; },
    "a different terminal is shown": ({ r }) => { r.panes[0].shown = "t2"; r.focus.shown = "t2"; }
  };
  for (const [scenario, change] of Object.entries(changes)) await t.test(scenario, async t => {
    const setup = await fixture(t), { r } = setup, { action, menu } = setup.open();
    r.cx.sleep = async () => change({ ...setup, menu });
    action.handlers.on_click({}, r.cx);
    await r.drain();
    assert.equal(r.pasted, undefined);
    assert.equal(r.clipboard, "original clipboard");
    assert.equal(r.calls.filter(call => /paste|send|enter/.test(call.command)).length, 0);
    if (!menu.closed) assert.match(menu.error, /changed|no longer available/);
  });
});
