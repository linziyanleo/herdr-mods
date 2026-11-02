import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { runtime, find } from "./runtime.mjs";

test("retained chunks rebuild no rows on unrelated renders and only changed chunks on marks", async t => {
  const r = await runtime(t), { default: Files } = await r.load("main.js");
  const panel = new Files(); panel.init({}, r.cx); await r.drain();
  panel.entries.set(r.dir, Array.from({ length: 250 }, (_, n) => ({ name: `${n}.txt`, dir: false })));
  panel.treeVersion++; panel.syncTree(r.cx);
  find(panel.render(r.cx), "absent"); assert.equal(r.rebuiltRows, 250);
  r.rebuiltRows = 0;
  for (let n = 0; n < 20; n++) find(panel.render(r.cx), "absent");
  await r.drain(); assert.equal(r.rebuiltRows, 0);
  panel.marks[path.join(r.dir, "120.txt")] = "M"; panel.treeVersion++; panel.syncTree(r.cx);
  find(panel.render(r.cx), "absent"); assert.equal(r.rebuiltRows, 100);
});

test("watch changes map physical aliases, ignore locks and reload expanded parents only", async t => {
  const r = await runtime(t), { changedDirectories } = await r.load("workspace.js");
  const roots = [{ path: "/tmp/project", physical: "/private/tmp/project" }], expanded = new Set(["/tmp/project", "/tmp/project/src"]);
  const changes = changedDirectories(["/private/tmp/project/src/a.ts", "/tmp/project/node_modules/pkg/index.js", "/tmp/project/.git/index.lock"], roots, expanded);
  assert.deepEqual([...changes.paths], ["/tmp/project/src"]); assert.equal(changes.git, true);
  assert.equal(changedDirectories(["/tmp/project/.git/index.lock"], roots, expanded).git, false);
  assert.equal(changedDirectories(["/tmp/project/.git/refs/heads/main"], roots, expanded).git, true);
});

test("refresh caches root discovery, throttles status and suppresses no-op redraws", async t => {
  const r = await runtime(t), { default: Files } = await r.load("main.js");
  await r.load("roots.js");
  r.hooks.exec = async (command, args) => command === "git" ? { code: 0, stdout: args.includes("rev-parse") ? r.dir : "", stderr: "" } : null;
  const panel = new Files(); panel.init({}, r.cx); await r.drain();
  const before = r.notifications; r.calls = [];
  panel.refresh(r.cx); await r.drain();
  assert.equal(r.notifications, before); assert.equal(r.calls.filter(c => c.command === "git").length, 0);
  await fs.writeFile(path.join(r.dir, "new.txt"), "new");
  panel.queueChanges([path.join(r.dir, "new.txt")], r.cx); await r.advance(200);
  assert.ok(panel.entries.get(r.dir).some(e => e.name === "new.txt"));
  assert.equal(r.calls.filter(c => c.command === "git").length, 0);
  panel.gitCache.get(r.dir).at -= 2001;
  await r.advance(2000);
  assert.equal(r.calls.filter(c => c.command === "git" && c.args.includes("status")).length, 1);
});

test("parallel listing is bounded at four and hidden local safety polls do no work", async t => {
  const r = await runtime(t), { default: Files } = await r.load("main.js");
  const folders = await Promise.all(Array.from({ length: 8 }, async (_, n) => { const folder = path.join(r.dir, `r${n}`); await fs.mkdir(folder); return { path: folder }; }));
  r.shared["multi-root.spaces"] = { s1: { folders } };
  let active = 0, peak = 0;
  r.hooks.exec = async (cmd, args) => {
    if (cmd === "sh" && args[1]?.startsWith("n=0")) { peak = Math.max(peak, ++active); await new Promise(resolve => setTimeout(resolve, 5)); active--; }
  };
  const panel = new Files(); panel.init({}, r.cx); await r.drain();
  assert.equal(peak, 4); assert.equal(panel.entryCount, 0);
  find(panel.render(r.cx), "files-plus").handlers.on_size_change({ width: 0, height: 0 }, r.cx);
  r.calls = []; r.timers.find(timer => timer.repeat && timer.ms === 60000).fn(r.cx); await r.drain(); assert.equal(r.calls.length, 0);
});
