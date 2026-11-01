import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { runtime } from "./runtime.mjs";

test("agent references use the captured cwd only within the owning root", async t => {
  const r = await runtime(t), a = await r.load("actions.js"), target = r.target("src/a b.ts");
  assert.equal(a.reference(target), '@"src/a b.ts" ');
  target.active.cwd = path.join(r.dir, "other");
  assert.equal(a.reference(target), `@"${target.path}" `);
  target.active.cwd = "/somewhere-else";
  assert.equal(a.reference(target), `@"${target.path}" `);
  target.active.cwd = r.dir;
  target.path = path.join(r.dir, "quote\"name.ts");
  assert.equal(a.reference(target), '@"quote\\"name.ts" ');
  r.focus = { space: "other", pane: "p2", terminal: "t2" };
  assert.equal(a.captureTarget("s1", target.path, "file", r.dir, null).active, null);
});

test("agent references match a workspace root through its physical alias", async t => {
  const r = await runtime(t), a = await r.load("actions.js");
  r.focus.cwd = "/physical/web/src";
  const target = a.captureTarget("s1", "/declared/web/src/app.ts", "file", "/declared/web", null, "/physical/web");
  assert.equal(a.reference(target), "@app.ts ");
  r.focus.cwd = "/physical/web";
  assert.equal(a.reference(a.captureTarget("s1", "/declared/web/README.md", "file", "/declared/web", null, "/physical/web")), "@README.md ");
});

test("agent insertion restores clipboard text and never submits Enter", async t => {
  const r = await runtime(t), a = await r.load("actions.js");
  const target = r.target("README.md");
  r.focus = { space: "other", pane: "p2", terminal: "t2" };
  await a.insertReference(target, r.cx);
  assert.equal(r.pasted, "@README.md ");
  assert.equal(r.clipboard, "original clipboard");
  assert.deepEqual(r.calls.map(c => c.command), ["pane.focus", "terminal.paste"]);
  r.panes = [];
  await assert.rejects(a.insertReference(target, r.cx), /no longer available/);
});

test("copy/paste chooses available names and preserves original bytes", async t => {
  const r = await runtime(t), a = await r.load("actions.js");
  await fs.writeFile(path.join(r.dir, "report.txt"), "original");
  r.shared[a.CLIPBOARD] = { path: path.join(r.dir, "report.txt"), kind: "file", on: null };
  const target = r.target("", "dir");
  assert.equal(await a.paste(target), path.join(r.dir, "report copy.txt"));
  assert.equal(await a.paste(target), path.join(r.dir, "report copy 2.txt"));
  await fs.mkdir(path.join(r.dir, "another"));
  assert.equal(await a.paste(r.target("another", "dir")), path.join(r.dir, "another/report.txt"));
  for (const name of ["report.txt", "report copy.txt", "report copy 2.txt", "another/report.txt"]) assert.equal(await fs.readFile(path.join(r.dir, name), "utf8"), "original");
  assert.equal(r.shared[a.REVISION], 3);
});

test("directory copies reject descendants and physical symlink cycles", async t => {
  const r = await runtime(t), a = await r.load("actions.js");
  await fs.mkdir(path.join(r.dir, "folder/child"), { recursive: true });
  await fs.writeFile(path.join(r.dir, "folder/a.txt"), "contents");
  await fs.symlink(path.join(r.dir, "folder/child"), path.join(r.dir, "alias"));
  r.shared[a.CLIPBOARD] = { path: path.join(r.dir, "folder"), kind: "dir", on: null };
  for (const dest of ["folder", "folder/child", "alias"]) await assert.rejects(a.paste(r.target(dest, "dir")), /itself or a descendant/);
  await a.paste(r.target("", "dir"));
  assert.equal(await fs.readFile(path.join(r.dir, "folder copy/a.txt"), "utf8"), "contents");
  await fs.symlink("missing", path.join(r.dir, "folder copy 2"));
  assert.equal(await a.paste(r.target("", "dir")), path.join(r.dir, "folder copy 3"));
});

test("symlinks copy as links; dotfiles and folder dots keep correct names", async t => {
  const r = await runtime(t), a = await r.load("actions.js");
  await fs.writeFile(path.join(r.dir, ".env"), "example");
  await fs.symlink(".env", path.join(r.dir, "link"));
  r.shared[a.CLIPBOARD] = { path: path.join(r.dir, "link"), kind: "file", on: null };
  await a.paste(r.target("", "dir"));
  assert.equal(await fs.readlink(path.join(r.dir, "link copy")), ".env");
  assert.equal(path.basename(await a.availablePath(r.dir, ".env", "file", null)), ".env copy");
  await fs.mkdir(path.join(r.dir, "folder.name"));
  assert.equal(path.basename(await a.availablePath(r.dir, "folder.name", "dir", null)), "folder.name copy");
});

test("CRUD rejects invalid/existing names and treats shell syntax literally", async t => {
  const r = await runtime(t), a = await r.load("actions.js"), target = r.target("", "dir");
  for (const name of ["", " ", ".", "..", "../x", "a/b", "a\\b", "a\0b", "a\nb"]) await assert.rejects(a.createEntry(target, "file", name), /name/);
  const name = "a'$(touch injected);.txt";
  await a.createEntry(target, "file", name);
  assert.equal(await fs.readFile(path.join(r.dir, name), "utf8"), "");
  await fs.writeFile(path.join(r.dir, name), "preserve");
  await assert.rejects(a.createEntry(target, "file", name), /already exists/);
  await a.createEntry(target, "dir", "new folder");
  await a.renameEntry(r.target(name), "renamed.txt");
  await fs.writeFile(path.join(r.dir, "existing"), "existing");
  await assert.rejects(a.renameEntry(r.target("renamed.txt"), "existing"), /already exists/);
  assert.equal(await fs.readFile(path.join(r.dir, "renamed.txt"), "utf8"), "preserve");
  await a.renameEntry(r.target("new folder", "dir"), "renamed folder");
  assert.ok((await fs.stat(path.join(r.dir, "renamed folder"))).isDirectory());
  assert.equal(await a.exists(path.join(r.dir, "injected"), null), false);
  await assert.rejects(a.renameEntry(r.target("", "root"), "x"), /cannot be renamed/);
});

test("local macOS deletion moves to a collision-safe Trash and protects roots", async t => {
  const r = await runtime(t), a = await r.load("actions.js");
  const trash = path.join(r.dir, "home/.Trash");
  await fs.mkdir(trash);
  await fs.writeFile(path.join(trash, "remove.txt"), "previous");
  await fs.writeFile(path.join(r.dir, "remove.txt"), "new");
  await a.trashEntry(r.target("remove.txt"));
  assert.equal(await a.exists(path.join(r.dir, "remove.txt"), null), false);
  assert.equal(await fs.readFile(path.join(trash, "remove.txt"), "utf8"), "previous");
  assert.equal(await fs.readFile(path.join(trash, "remove copy.txt"), "utf8"), "new");
  await assert.rejects(a.trashEntry(r.target("", "root")), /cannot be removed/);
});

test("cross-machine paste and remote reveal are disabled; remote CRUD keeps routing", async t => {
  const r = await runtime(t), a = await r.load("actions.js");
  const target = r.target("", "dir");
  r.shared[a.CLIPBOARD] = { path: r.dir, kind: "dir", on: "server" };
  assert.equal(a.menuItems(target).find(i => i.id === "paste").enabled, false);
  await assert.rejects(a.paste(target), /same machine/);
  r.spaces[0].machine = "server"; target.on = "server";
  assert.equal(a.menuItems(target).find(i => i.id === "reveal").enabled, false);
  await assert.rejects(a.reveal(target), /local files/);
  await a.createEntry(target, "file", "remote.txt");
  assert.ok(r.calls.filter(c => ["sh", "mkdir"].includes(c.command)).every(c => c.on === "server"));
});

test("reveal uses platform-specific commands without shell interpolation", async t => {
  const r = await runtime(t), a = await r.load("actions.js"), target = r.target("file name.txt");
  await a.reveal(target);
  assert.deepEqual(r.calls.at(-1).args, ["-R", target.path]);
  r.platform = "linux"; await a.reveal(target);
  assert.equal(r.calls.at(-1).command, "xdg-open");
  assert.deepEqual(r.calls.at(-1).args, [r.dir]);
  r.platform = "windows"; await a.reveal(target);
  assert.equal(r.calls.at(-1).command, "explorer.exe");
});
