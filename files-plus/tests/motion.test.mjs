import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { runtime, find } from "./runtime.mjs";

function mountRow(panel, id, r) {
  const chunk = panel.chunks.find(chunk => find(chunk.entity, id));
  const cx = { ...r.cx, notify: () => r.cx.notify(chunk.entity),
    timer: { ...r.cx.timer, after: (ms, fn) => r.cx.timer.after(ms, () => fn(cx)) } };
  find(chunk.entity, id).handlers.on_size_change({ width: 320, height: 0 }, cx);
}

test("folder children open from zero height and stay mounted while collapsing", async t => {
  const r = await runtime(t), { default: Files } = await r.load("main.js");
  const folder = path.join(r.dir, "home"), file = path.join(folder, "child.txt");
  await fs.writeFile(file, "child");
  const panel = new Files(); panel.init({}, r.cx); await r.drain();
  panel.toggle(folder, r.cx);
  while (r.tasks.length) await Promise.all(r.tasks.splice(0));
  assert.equal(find(panel.render(r.cx), `file-${file}`).attributes.h[0], 0);
  await r.drain();
  assert.equal(find(panel.render(r.cx), `file-${file}`).attributes.h[0], 0, "timers cannot skip the initial native layout");
  mountRow(panel, `file-${file}`, r); await r.drain();
  assert.equal(find(panel.render(r.cx), `file-${file}`).attributes.h[0], 28);
  panel.toggle(folder, r.cx);
  const closing = find(panel.render(r.cx), `file-${file}`);
  assert.equal(closing.attributes.h[0], 0); assert.equal(closing.attributes.disabled[0], true);
  assert.equal(panel.entries.has(folder), false); assert.equal(panel.folders.has(folder), false);
  closing.handlers.on_click({}, r.cx); closing.handlers["on_mouse_down:right"]({}, r.cx);
  assert.equal(panel.clickedRow, undefined); assert.equal(r.calls.some(call => call.command === "openOverlay"), false);
  await r.advance(249); assert.ok(find(panel.render(r.cx), `file-${file}`));
  await r.advance(250); assert.equal(find(panel.render(r.cx), `file-${file}`), null);
});

test("reopening a folder during its exit keeps its rows after the old cleanup", async t => {
  const r = await runtime(t), { default: Files } = await r.load("main.js");
  const folder = path.join(r.dir, "home"), file = path.join(folder, "child.txt"); await fs.writeFile(file, "child");
  const panel = new Files(); panel.init({}, r.cx); await r.drain();
  panel.toggle(folder, r.cx); await r.drain();
  mountRow(panel, `file-${file}`, r); await r.drain();
  panel.toggle(folder, r.cx); panel.toggle(folder, r.cx); await r.drain();
  const reopened = find(panel.render(r.cx), `file-${file}`);
  assert.equal(reopened.attributes.h[0], 28); assert.equal(reopened.attributes.disabled[0], false);
  await r.advance(250);
  assert.ok(find(panel.render(r.cx), `file-${file}`)); assert.equal(panel.folders.has(folder), true);
});

test("a late folder read cannot revive collapsed children and close cancels motion cleanup", async t => {
  const r = await runtime(t), { default: Files } = await r.load("main.js");
  const panel = new Files(); panel.init({}, r.cx); await r.drain();
  const folder = path.join(r.dir, "home"); let reply;
  r.hooks.exec = async (command, args) => command === "sh" && args[1]?.startsWith("n=0") && args.at(-1) === folder ? new Promise(resolve => { reply = resolve; }) : null;
  panel.toggle(folder, r.cx);
  while (!reply) await Promise.resolve();
  panel.toggle(folder, r.cx); reply({ code: 0, stdout: "f\0late.txt\0", stderr: "" }); await r.drain();
  assert.equal(panel.entries.has(folder), false); assert.equal(panel.rowModel.some(row => row.name === "late.txt"), false);
  panel.close(); const notifications = r.notifications;
  await r.advance(250); assert.equal(r.notifications, notifications);
});

test("mounting a loading placeholder cannot reveal its replacement children before layout", async t => {
  const r = await runtime(t), { default: Files } = await r.load("main.js");
  const panel = new Files(); panel.init({}, r.cx); await r.drain();
  const folder = path.join(r.dir, "home"), file = path.join(folder, "child.txt"); let reply;
  r.hooks.exec = async (command, args) => command === "sh" && args[1]?.startsWith("n=0") && args.at(-1) === folder ? new Promise(resolve => { reply = resolve; }) : null;
  panel.toggle(folder, r.cx);
  while (!reply) await Promise.resolve();
  mountRow(panel, `empty-${folder}`, r);
  reply({ code: 0, stdout: "f\0child.txt\0", stderr: "" }); await r.drain();
  assert.equal(find(panel.render(r.cx), `file-${file}`).attributes.h[0], 0);
  r.theme.foreground = "#ffffff"; panel.syncTree(r.cx); await r.drain();
  assert.equal(find(panel.render(r.cx), `file-${file}`).attributes.h[0], 0, "a props update must preserve the pending entrance");
  mountRow(panel, `file-${file}`, r); await r.drain();
  assert.equal(find(panel.render(r.cx), `file-${file}`).attributes.h[0], 28);
});
