import { test } from "node:test";
import assert from "node:assert/strict";
import { runtime, find } from "./runtime.mjs";

test("text widths count CJK and emoji and menu sizing includes every label and error", async t => {
  const r = await runtime(t), m = await r.load("metrics.js"), a = await r.load("actions.js"), metrics = { unit13: 8, unit12: 7 };
  assert.equal(m.textUnits("A中文😀"), 7);
  assert.equal(m.textUnits("⚠️⌛"), 4);
  const items = [{ label: "Copy", enabled: true }, { label: "中文文件夹名称".repeat(3), group: true }];
  const view = { width: 1600, height: 1000 };
  const normal = a.menuLayout(items, "", metrics, view, { x: 1598, y: 998 }, 1);
  assert.equal(normal.width, m.textWidth(items[1].label, 13, metrics) + 30);
  assert.equal(normal.height, 60 + 9 + 10 + 24);
  assert.equal(normal.at.x + normal.width, 1592); assert.equal(normal.at.y + normal.height, 992);
  const error = a.menuLayout(items, "Error ".repeat(30), metrics, view, { x: 1598, y: 998 }, 1);
  assert.ok(error.width > normal.width); assert.equal(error.height, normal.height);
  const capped = a.menuLayout(items, "Error ".repeat(100), metrics, { width: 600, height: 900 }, { x: 599, y: 899 }, 1.2);
  assert.equal(capped.width, 484); assert.ok(capped.at.x + capped.width * 1.2 <= 600 - 8 * 1.2);
  assert.equal(a.menuLayout([{ label: "x" }], "", metrics, view, null, 1).width, 188);
});

test("dialog sizing follows action, text and viewport bounds", async t => {
  const r = await runtime(t), m = await r.load("metrics.js");
  assert.ok(m.dialogLayout("add-root", { path: "/a" }).height >= 240);
  assert.ok(m.dialogLayout("trash", { path: "/a" }).height > m.dialogLayout("rename", { path: "/a" }).height);
  assert.equal(m.dialogLayout("rename", { path: "/long".repeat(100) }).width, 560);
  assert.ok(m.dialogLayout("rename", { path: "/long".repeat(100) }, { width: 500, height: 800 }, 1.2).width < 420);
});

test("painted calibration probes normalize zoom and reset when appearance metrics change", async t => {
  const r = await runtime(t), m = await r.load("metrics.js");
  r.settings.zoom = 1.2;
  const probe = m.calibrationProbe(() => {});
  find(probe, "metrics-13-0").handlers.on_size_change({ width: 120, height: 16 }, r.cx);
  find(probe, "metrics-13-1").handlers.on_size_change({ width: 18 * 6 * 1.2, height: 16 }, r.cx);
  assert.equal(m.metrics().unit13, 10);
  r.settings.zoom = 1;
  assert.equal(m.metrics().unit13, 0.6 * 13);
});
