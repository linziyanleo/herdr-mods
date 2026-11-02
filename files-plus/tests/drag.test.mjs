import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { runtime, find } from "./runtime.mjs";

test("Agent fallback uses the active tab and preserves cross-space isolation", async t => {
  const r = await runtime(t), a = await r.load("actions.js");
  r.focus = { space: "s1", terminal: null };
  r.panes.push({ pane: "agent", terminal: "t2", cwd: r.dir, tab: "tab1", program: { agent: true } }, { pane: "elsewhere", terminal: "t3", tab: "other", focused: true });
  const capture = () => a.captureTarget("s1", r.dir, "root", r.dir, null).active?.terminal;
  assert.equal(capture(), "t2");
  r.panes[0].focused = true; assert.equal(capture(), "t1");
  r.focus = null; assert.equal(capture(), "t1");
  r.focus = { space: "s2", terminal: null }; assert.equal(capture(), undefined);
});

test("short movement preserves clicks while drag threshold opens a full-window overlay", async t => {
  const r = await runtime(t), { default: Files } = await r.load("main.js");
  const file = path.join(r.dir, "a.txt"); await fs.writeFile(file, "A");
  const panel = new Files(); panel.init({}, r.cx); await r.drain();
  const tree = panel.render(r.cx), row = find(tree, `file-${file}`), root = find(tree, "files-plus");
  const bounds = { x: 1000, y: 40, width: 600, height: 960 };
  row.handlers["on_mouse_down:left"]({ position: { x: 1100, y: 100 } }, r.cx);
  root.handlers.on_mouse_down({ bounds }, r.cx);
  root.handlers.on_mouse_move({ position: { x: 1105, y: 100 } }, r.cx);
  assert.equal(r.calls.some(c => c.command === "openOverlay"), false);
  const childCx = { stop_propagation() {}, spawn() { throw Error("A child cannot start a parent-owned task"); } };
  root.handlers.on_mouse_up({}, r.cx); row.handlers.on_click({}, childCx); root.handlers.on_click({}, r.cx);
  await r.drain(); assert.equal(panel.file, file);
  panel.show(null);
  row.handlers["on_mouse_down:left"]({ position: { x: 1100, y: 100 } }, r.cx);
  root.handlers.on_mouse_move({ position: { x: 1106, y: 100 } }, r.cx);
  const spec = r.calls.find(c => c.command === "openOverlay").spec;
  assert.equal(spec.props.role, "drag"); assert.equal(spec.width, 1600); assert.equal(spec.height, 1000); assert.equal(spec.frame, "none");
  row.handlers.on_click({}, r.cx); assert.equal(panel.file, null);
});

test("drag release outside pastes one reference without Enter and restores clipboard; inside/Escape cancel", async t => {
  const r = await runtime(t), { default: Files } = await r.load("main.js");
  const bounds = { x: 1000, y: 40, width: 600, height: 960 };
  const create = cursor => {
    r.props = { role: "drag", target: r.target("some file.txt"), panelBounds: bounds, cursor, overlay: "drag1" };
    const drag = new Files(); drag.init({}, r.cx); return drag;
  };
  let drag = create({ x: 1100, y: 100 });
  drag.render(r.cx).handlers.on_mouse_up({ position: drag.cursor }, r.cx); await r.drain();
  assert.equal(r.pasted, undefined);
  drag = create({ x: 500, y: 100 });
  drag.render(r.cx).handlers.on_key_down({ key: "escape" }, r.cx); await r.drain(); assert.equal(r.pasted, undefined);
  drag = create({ x: 500, y: 100 });
  drag.render(r.cx).handlers.on_mouse_up({ position: drag.cursor }, r.cx); await r.drain();
  assert.equal(r.pasted, '@"some file.txt" '); assert.equal(r.clipboard, "original clipboard");
  assert.equal(r.calls.filter(c => c.command === "terminal.paste").length, 1);
  assert.ok(!/[\r\n]/.test(r.pasted));
});
