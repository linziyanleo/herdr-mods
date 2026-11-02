import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { runtime } from "./runtime.mjs";

test("panel fitting measures the header and top-level rows independently of expansion", async t => {
  const r = await runtime(t), f = await r.load("fit.js"), m = { unit13: 8, unit12: 7 };
  const short = f.panelWidth([{ kind: "file", depth: 0, name: "a" }], "Project", m);
  assert.ok(f.panelWidth([], "Workspace ".repeat(20), m) > short);
  assert.ok(f.panelWidth([{ kind: "root", name: "Root", detail: "/long".repeat(20) }], "Project", m) > short);
  const entry = { kind: "file", depth: 5, name: "中文文件名".repeat(5), mark: "M" };
  assert.equal(f.panelWidth([entry], "Project", m), f.panelWidth([], "Project", m));
  assert.ok(f.panelWidth([{ ...entry, depth: 0 }], "Project", m) > f.panelWidth([{ ...entry, depth: 0, name: "x".repeat(25) }], "Project", m));
});

test("expanding and collapsing nested folders never resize the fitted panel", async t => {
  const r = await runtime(t), { default: Files } = await r.load("main.js");
  const folder = path.join(r.dir, "home"), nested = path.join(folder, "nested");
  await fs.mkdir(nested);
  await fs.writeFile(path.join(nested, "long-name-".repeat(20) + ".txt"), "nested");
  r.props.fit = { node: "panel", min: 280, max: 800 }; r.layout = { id: "panel", min: 280, max: 900 };
  const panel = new Files(); panel.init({}, r.cx); await r.drain();
  panel.panelResized({ width: 600, height: 800 }, r.cx); await r.advance(250);
  const initial = r.calls.find(c => c.command === "layout.resize").args.px;
  panel.panelResized({ width: initial, height: 800 }, r.cx); r.calls = [];
  for (const target of [folder, nested, nested, folder]) {
    panel.toggle(target, r.cx); await r.drain(); await r.advance(250);
    assert.equal(r.calls.filter(c => c.command === "layout.resize").length, 0, target);
  }
});

test("ratio and pixel caps normalize zoom and reserve main-workspace width", async t => {
  const r = await runtime(t), f = await r.load("fit.js");
  const tree = { children: [{ id: "sidebar", size: { px: 268 } }, { id: "panel", min: 280, max: 900 }] };
  assert.equal(f.fittedWidth(1000, { node: "panel", max: 0.38 }, tree, { width: 1600 }, 1), 608);
  assert.equal(f.fittedWidth(1000, { node: "panel", max: 0.38 }, tree, { width: 1600 }, 1.2), 506);
  assert.equal(f.fittedWidth(1000, { node: "panel", max: 850 }, tree, { width: 1000 }), 372);
  assert.equal(f.fittedWidth(1000, { node: "panel" }, tree, null), 560);
  assert.equal(f.fittedWidth(100, { node: "panel" }, tree, { width: 1600 }), 280);
  assert.equal(f.shouldFit(350, 500, "user"), true); assert.equal(f.shouldFit(350, 500, "background"), false);
  assert.equal(f.shouldFit(515, 500, "user"), false); assert.equal(f.shouldFit(517, 500, "background"), true);
});

test("auto-fit debounces, grows only in background and pauses after manual resizing until context changes", async t => {
  const r = await runtime(t), { default: Files } = await r.load("main.js");
  r.props.fit = { node: "panel", min: 280, max: 800 }; r.layout = { id: "panel", min: 280, max: 900 };
  const panel = new Files(); panel.init({}, r.cx); await r.drain();
  panel.panelResized({ width: 600, height: 800 }, r.cx); await r.advance(250);
  const first = r.calls.find(c => c.command === "layout.resize"); assert.ok(first.args.px < 600);
  panel.resizePending = null;
  panel.panelResized({ width: 600, height: 780 }, r.cx); assert.equal(panel.manualWidthSpace, null);
  panel.panelResized({ width: first.args.px, height: 800 }, r.cx); r.calls = [];
  panel.panelResized({ width: 500, height: 800 }, r.cx);
  assert.equal(panel.manualWidthSpace, "s1");
  panel.treeVersion++; panel.scheduleFit(r.cx, "user"); await r.advance(250);
  assert.equal(r.calls.filter(c => c.command === "layout.resize").length, 0);
  r.spaces[0].folder = "/different"; r.focus.cwd = "/different"; r.panes[0].cwd = "/different";
  panel.render(r.cx); await r.drain(); assert.equal(panel.manualWidthSpace, null);
});
