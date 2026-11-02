import { test } from "node:test";
import assert from "node:assert/strict";
import { runtime, find } from "./runtime.mjs";

test("text widths count CJK and emoji and menu sizing includes every label and error", async t => {
  const r = await runtime(t), m = await r.load("metrics.js"), a = await r.load("actions.js"), metrics = { unit13: 8, unit12: 7 };
  const look = (await r.load("appearance.js")).appearance(r.cx);
  assert.equal(m.textUnits("A中文😀"), 7);
  assert.equal(m.textUnits("⚠️⌛"), 4);
  const items = [{ label: "Copy", enabled: true }, { label: "中文文件夹名称".repeat(3), group: true }];
  const view = { width: 1600, height: 1000 };
  const normal = a.menuLayout(items, "", metrics, view, { x: 1598, y: 998 }, 1, look);
  assert.equal(normal.width, m.textWidth(items[1].label, 13, metrics) + 2 * look.spacing.md + 2 * look.spacing.xs);
  assert.equal(normal.height, 64 + 9 + 8 + 24);
  assert.equal(normal.at.x + normal.width, 1592); assert.equal(normal.at.y + normal.height, 992);
  const error = a.menuLayout(items, "Error ".repeat(30), metrics, view, { x: 1598, y: 998 }, 1, look);
  assert.ok(error.width > normal.width); assert.equal(error.height, normal.height);
  const capped = a.menuLayout(items, "Error ".repeat(100), metrics, { width: 600, height: 900 }, { x: 599, y: 899 }, 1.2, look);
  assert.equal(capped.width, 484); assert.ok(capped.at.x + capped.width * 1.2 <= 600 - 8 * 1.2);
  assert.equal(a.menuLayout([{ label: "x" }], "", metrics, view, null, 1, look).width, 188);
});

test("dialog sizing follows action, text and viewport bounds", async t => {
  const r = await runtime(t), m = await r.load("metrics.js");
  assert.ok(m.dialogLayout("add-root", { path: "/a" }, r.cx).height >= 240);
  assert.ok(m.dialogLayout("trash", { path: "/a" }, r.cx).height > m.dialogLayout("rename", { path: "/a" }, r.cx).height);
  assert.equal(m.dialogLayout("rename", { path: "/long".repeat(100) }, r.cx).width, 560);
  assert.ok(m.dialogLayout("rename", { path: "/long".repeat(100) }, r.cx, { width: 500, height: 800 }, 1.2).width < 420);
});

test("painted calibration probes normalize zoom and reset when appearance metrics change", async t => {
  const r = await runtime(t), m = await r.load("metrics.js");
  r.settings.zoom = 1.2;
  const probe = m.calibrationProbe(r.cx, () => {});
  find(probe, "metrics-13-0").handlers.on_size_change({ width: 120, height: 16 }, r.cx);
  find(probe, "metrics-13-1").handlers.on_size_change({ width: 18 * 6 * 1.2, height: 16 }, r.cx);
  assert.equal(m.metrics(r.cx).unit13, 10);
  r.settings.zoom = 1;
  assert.equal(m.metrics(r.cx).unit13, 0.6 * r.semantic.typography.md.size);
});
