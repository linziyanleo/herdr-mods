import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { runtime } from "./runtime.mjs";

test("adding a folder captures its space and does not replace terminals or names", async t => {
  const r = await runtime(t), c = await r.load("config.js"), target = r.target("", "root"), captured = await c.workspaceSnapshot(target);
  assert.equal(await c.changeRoots(target, "add-root", null, captured), false);
  assert.equal(await c.changeRoots(target, "add-root", r.dir, captured), false);
  assert.equal(r.shared["multi-root.spaces"], undefined);
  const before = JSON.stringify(r.spaces);
  r.focus = { space: "other", cwd: "/other" };
  await c.changeRoots(target, "add-root", path.join(r.dir, "api"), captured);
  assert.equal(JSON.stringify(r.spaces), before);
  const entry = r.shared["multi-root.spaces"].s1;
  assert.equal(entry.name, "Product"); assert.equal(entry.file, null);
  assert.deepEqual(Array.from(entry.folders, f => f.path), [r.dir, path.join(r.dir, "api")]);
});

async function savedWorkspace(r) {
  const file = path.join(r.dir, "Product.herdr-workspace.json");
  const raw = { name: "Product", folders: ["./web", { path: "./api", name: "API", color: "keep" }], custom: { keep: true } };
  await fs.writeFile(file, JSON.stringify(raw));
  const roots = await r.load("roots.js"), parsed = roots.parseConfig(JSON.stringify(raw), file);
  r.shared["multi-root.spaces"] = { s1: { name: parsed.name, file, folders: parsed.folders } };
  return { file, raw, target: r.target("web", "root", path.join(r.dir, "web")) };
}

test("workspace saves preserve path spelling and unknown fields for add/remove", async t => {
  const r = await runtime(t), c = await r.load("config.js"), { file, raw, target } = await savedWorkspace(r);
  await c.changeRoots(target, "add-root", path.join(r.dir, "notes"), await c.workspaceSnapshot(target));
  let text = await fs.readFile(file, "utf8"), result = JSON.parse(text);
  assert.deepEqual(result.custom, raw.custom);
  assert.deepEqual(result.folders.slice(0, 2), raw.folders);
  assert.deepEqual(result.folders[2], { path: "notes" });
  assert.ok(text.endsWith("\n"));
  await c.changeRoots(target, "remove-root", null, await c.workspaceSnapshot(target));
  result = JSON.parse(await fs.readFile(file, "utf8"));
  assert.deepEqual(result.folders, [raw.folders[1], { path: "notes" }]);
  assert.equal(r.shared["multi-root.recent"][0], file);
});

test("external edits reject stale saves and reload without overwriting disk", async t => {
  const r = await runtime(t), c = await r.load("config.js"), { file, target } = await savedWorkspace(r);
  const captured = await c.workspaceSnapshot(target);
  const external = JSON.stringify({ name: "External", folders: ["./external"], keep: "new" });
  await fs.writeFile(file, external);
  await assert.rejects(c.changeRoots(target, "add-root", path.join(r.dir, "notes"), captured), /changed on disk/);
  assert.equal(await fs.readFile(file, "utf8"), external);
  assert.equal(r.shared["multi-root.spaces"].s1.name, "External");
});

test("opening an action refreshes an existing external edit before changing roots", async t => {
  const r = await runtime(t), c = await r.load("config.js"), { file, target } = await savedWorkspace(r);
  await fs.writeFile(file, JSON.stringify({ name: "External", folders: ["./web", "./new-on-disk"], extra: 42 }));
  const captured = await c.workspaceSnapshot(target);
  await c.changeRoots(target, "add-root", path.join(r.dir, "notes"), captured);
  const result = JSON.parse(await fs.readFile(file, "utf8"));
  assert.deepEqual(result.folders, ["./web", "./new-on-disk", { path: "notes" }]);
  assert.equal(result.extra, 42);
});

test("invalid workspace JSON keeps the last valid mapping and exposes its error", async t => {
  const r = await runtime(t), roots = await r.load("roots.js"), { file } = await savedWorkspace(r);
  const before = Array.from(r.shared["multi-root.spaces"].s1.folders, f => f.path);
  await fs.writeFile(file, "{invalid");
  await assert.rejects(roots.reloadWorkspace("s1"), /Invalid workspace JSON/);
  assert.deepEqual(Array.from(r.shared["multi-root.spaces"].s1.folders, f => f.path), before);
  assert.match(r.shared["multi-root.spaces"].s1.error, /Invalid workspace JSON/);
});

test("last-root removal and changed/closed target mappings are refused", async t => {
  const r = await runtime(t), c = await r.load("config.js"), target = r.target("", "root");
  r.shared["multi-root.spaces"] = { s1: { name: "One", file: null, folders: [{ path: r.dir }] } };
  let captured = await c.workspaceSnapshot(target);
  await assert.rejects(c.changeRoots(target, "remove-root", null, captured), /at least one/);
  r.shared["multi-root.spaces"].s1 = { name: "Replaced", file: null, folders: [{ path: "/another" }] };
  await assert.rejects(c.changeRoots(target, "add-root", "/notes", captured), /workspace changed/);
  captured = await c.workspaceSnapshot(target); r.spaces = [];
  await assert.rejects(c.changeRoots(target, "add-root", "/notes", captured), /no longer available/);
});

test("a space closed during an accepted save is not recreated in shared state", async t => {
  const r = await runtime(t), c = await r.load("config.js"), { target } = await savedWorkspace(r);
  const captured = await c.workspaceSnapshot(target);
  r.hooks.afterWrite = () => { r.spaces = []; delete r.shared["multi-root.spaces"].s1; };
  await c.changeRoots(target, "add-root", path.join(r.dir, "notes"), captured);
  assert.equal(r.shared["multi-root.spaces"].s1, undefined);
});
