import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import { until } from "./runtime.mjs";

// Run the actual driver against deterministic control-file interleavings.
// No window, core, installed app directory or native session is touched.
async function fixture() {
  const files = new Map(), shared = new Map(), watchers = new Set(), tasks = [], logs = [], hooks = {};
  const state = { files, tasks, logs, hooks, activations: 0, writes: [], base: "/fixture/control" };
  const emit = () => { for (const resolve of watchers) resolve([]); watchers.clear(); };
  const host = {
    props: () => ({ base: state.base, file: "/fixture/document.md" }),
    shared: key => shared.get(key), setShared: (key, value) => shared.set(key, value), closeOverlay() {}, settings: () => ({}), theme: () => ({}),
    readTextFile: async file => hooks.read ? hooks.read(file) : files.get(file) ?? null,
    writeTextFile: async (file, value, expected) => {
      state.writes.push({ file, value });
      if (hooks.write) await hooks.write(file, value, expected);
      if ((files.get(file) ?? null) !== expected) throw new Error("file changed outside Herdr");
      files.set(file, value); emit();
    },
    watchFolder: () => new Promise(resolve => watchers.add(resolve)),
  };
  class Panel {
    init() { this.expanded = new Set([""]); this.owner = { mode: "pane" }; }
    dirty() { return false; }
    render() { return {}; }
  }
  const context = vm.createContext({ console: { log: value => logs.push(value) }, window: { activate_window() { state.activations++; }, refresh() {} } });
  const driver = new vm.SourceTextModule(await fs.readFile(new URL("native-driver.js", import.meta.url), "utf8"), { context });
  await driver.link(specifier => {
    const exports = specifier === "./panel.js" ? { default: Panel } : specifier === "herdr" ? host : { jsonRows: () => ({ rows: [] }) };
    return new vm.SyntheticModule(Object.keys(exports), function () { for (const [key, value] of Object.entries(exports)) this.setExport(key, value); }, { context });
  });
  await driver.evaluate();
  state.cx = { notify() {}, timer: { every() {} }, spawn: fn => { const promise = Promise.resolve().then(() => fn(state.cx)); tasks.push(promise); return promise; } };
  state.start = async () => { const panel = new driver.namespace.default(); panel.init({}, state.cx); await new Promise(resolve => setImmediate(resolve)); return panel; };
  state.request = id => { files.set(state.base + "/request.json", JSON.stringify({ action: "activate", id })); emit(); };
  state.receipt = () => JSON.parse(files.get(state.base + "/receipt.json") || "null");
  return state;
}

test("only the newest driver instance handles requests and publishes state for a control directory", async () => {
  const state = await fixture(), old = await state.start(), current = await state.start();
  state.request("activate-current"); await until(() => state.receipt()?.id === "activate-current");
  assert.equal(state.activations, 1); assert.equal(state.receipt().driverIdentity, current.driverIdentity);
  const before = state.writes.length; old.record(state.cx); await new Promise(resolve => setImmediate(resolve)); assert.equal(state.writes.length, before);
  current.record(state.cx); await until(() => state.files.has(state.base + "/state.json"));
  assert.equal(JSON.parse(state.files.get(state.base + "/state.json")).driverIdentity, current.driverIdentity);
});

test("a competing receipt write is retried without rerunning or falsely failing activate", async () => {
  const state = await fixture(); await state.start(); let attempts = 0;
  state.hooks.write = async file => {
    if (file.endsWith("receipt.json") && ++attempts === 1) state.files.set(file, '{"old":"instance"}');
  };
  state.request("receipt-race"); await until(() => state.receipt()?.id === "receipt-race");
  assert.equal(attempts, 2); assert.equal(state.activations, 1); assert.equal(state.receipt().error, undefined); assert.deepEqual(state.logs, []);
});

test("an unchanged control-file I/O failure is logged once and not turned into an action error receipt", async () => {
  const state = await fixture(); await state.start(); let attempts = 0;
  state.hooks.write = async () => { attempts++; throw new Error("permission denied"); };
  state.request("io-error"); await until(() => state.logs.length > 0);
  assert.equal(attempts, 1); assert.equal(state.activations, 1); assert.equal(state.receipt(), null);
  assert.match(state.logs[0], /Preview fixture:.*permission denied/);
});

test("a request arriving during the previous receipt write is consumed without another filesystem event", async () => {
  const state = await fixture(); await state.start();
  state.hooks.write = async (file, value) => {
    if (file.endsWith("receipt.json") && JSON.parse(value).id === "first") state.request("second");
  };
  state.request("first"); await until(() => state.receipt()?.id === "second");
  assert.equal(state.activations, 2); assert.equal(state.receipt().error, undefined);
});

test("an old instance cannot write after ownership changes during its snapshot read", async () => {
  const state = await fixture(), old = await state.start(); let release;
  state.hooks.read = file => file.endsWith("state.json") ? new Promise(resolve => { release = resolve; }) : state.files.get(file) ?? null;
  const pending = old.writeControl("state.json", "old state"); await until(() => Boolean(release));
  await state.start(); release(null);
  assert.equal(await pending, false); assert.equal(state.files.has(state.base + "/state.json"), false);
});
