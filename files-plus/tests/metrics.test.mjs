import { test } from "node:test";
import assert from "node:assert/strict";
import { runtime } from "./runtime.mjs";

test("text widths count CJK and emoji and menu sizing includes every label and error", async t => {
  const r = await runtime(t), m = await r.load("metrics.js"), a = await r.load("actions.js"), metrics = { unit13: 8, unit12: 7 };
  assert.equal(m.textUnits("A中文😀"), 7);
  const items = [{ label: "Copy", enabled: true }, { label: "中文文件夹名称".repeat(3), group: true }];
  const view = { width: 1600, height: 1000 };
  const normal = a.menuLayout(items, "", metrics, view, { x: 1598, y: 998 }, 1);
  assert.equal(normal.width, m.textWidth(items[1].label, 13, metrics) + 34);
  assert.equal(normal.height, 64 + 8.5 + 10 + 24);
  assert.equal(normal.at.x + normal.width, 1592); assert.equal(normal.at.y + normal.height, 992);
  const error = a.menuLayout(items, "Error ".repeat(30), metrics, view, { x: 1598, y: 998 }, 1);
  assert.ok(error.width > normal.width); assert.equal(error.height, normal.height);
  const capped = a.menuLayout(items, "Error ".repeat(100), metrics, { width: 600, height: 900 }, { x: 599, y: 899 }, 1.2);
  assert.equal(capped.width, 484); assert.ok(capped.at.x + capped.width * 1.2 <= 600 - 8 * 1.2);
  assert.equal(a.menuLayout([{ label: "x" }], "", metrics, view, null).width, 188);
});

test("dialog sizing follows action, text and viewport bounds", async t => {
  const r = await runtime(t), m = await r.load("metrics.js");
  assert.equal(m.dialogLayout("add-root", { path: "/a" }).height, 220);
  assert.equal(m.dialogLayout("rename", { path: "/a" }).height, 240);
  assert.equal(m.dialogLayout("trash", { path: "/a" }).height, 252);
  assert.equal(m.dialogLayout("rename", { path: "/long".repeat(100) }).width, 560);
  assert.ok(m.dialogLayout("rename", { path: "/long".repeat(100) }, m.metrics(), { width: 500, height: 800 }, 1.2).width < 420);
});
