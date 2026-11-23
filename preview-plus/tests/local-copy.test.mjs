import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { runtime, find, until } from "./runtime.mjs";
import { png, pdf } from "./fixtures.mjs";

test("sync roots are normalized absolute directory boundaries", async t => {
  const state = await runtime(t), { syncRoots, localCopyPath } = await state.load("local-copy.js");
  const roots = syncRoots(["relative", null, "/sync/./docs/", "/sync/docs", "/bad\0path"]);
  assert.deepEqual(Array.from(roots), ["/sync/docs"]);
  for (const file of ["/sync/docs-other/image.png", "/sync/docs/../private/image.png", "/sync/docs", "/sync/docs/note.md"])
    assert.equal(localCopyPath({ file, on: "remote" }, roots), null);
  assert.equal(localCopyPath({ file: "/sync/docs/image.png", on: "remote" }, roots), "/sync/docs/image.png");
});

for (const platform of ["macos", "linux"]) {
  if (platform === "macos" && process.platform !== "darwin") continue;
  test(`${platform}: local image contents and cache identity follow the validated file`, async t => {
    const state = await runtime(t); state.platform = platform;
    const root = await fs.realpath(state.dir), file = path.join(root, "photo ' one.png");
    const local = png(320, 180), remote = png(180, 320, true);
    assert.notDeepEqual(local, remote);
    await fs.writeFile(file, local);
    state.props = { file, on: "remote", localSyncRoots: [root] };
    state.hooks.exec = async (_command, _args, options) => assert.ok(!options.on);
    const panel = await state.start();
    t.after(() => panel.close());
    assert.equal(panel.error, null);
    assert.equal(panel.selected.on, "remote");
    assert.equal(panel.media.width, 320);
    assert.equal(panel.media.height, 180);
    const view = state.render(), cached = path.join(state.dir, "app", panel.media.path);
    assert.match(find(view, "preview-local-copy").nodes.join(""), /Local copy.*remote.*Contents may differ/);
    assert.equal(find(view, "preview-open").handlers.on_click, undefined);
    panel.open(state.cx); await until(() => Boolean(panel.actionError));
    assert.match(panel.actionError, /only available for local/);
    assert.ok((await fs.lstat(cached)).isFile());
    assert.deepEqual(await fs.readFile(cached), local);

    const first = panel.media;
    panel.zoom = 1.4;
    panel.poll(state.cx); await until(() => !panel.mediaPoll);
    assert.equal(panel.media, first);
    assert.equal(panel.zoom, 1.4);

    const modified = png(280, 200, true), updated = path.join(root, "updated.png");
    await fs.writeFile(updated, modified);
    await fs.rename(updated, file);
    await state.change(root, [file]);
    await until(() => panel.media?.width === 280);
    assert.notEqual(panel.media.path, first.path);
    assert.deepEqual(await fs.readFile(path.join(state.dir, "app", panel.media.path)), modified);

    await fs.unlink(file);
    panel.poll(state.cx); await until(() => !panel.mediaPoll);
    assert.equal(panel.media, null);
    assert.match(panel.error, /Local copy unavailable.*missing/i);
    assert.equal(state.watches.size, 0);
    assert.deepEqual(await fs.readFile(cached), local);
    await fs.writeFile(file, local);
    panel.poll(state.cx); await until(() => !panel.loading && Boolean(panel.media));
    assert.equal(panel.error, null);
  });

  test(`${platform}: staging and metadata reject links and non-regular copies`, async t => {
    const state = await runtime(t); state.platform = platform;
    const base = await fs.realpath(state.dir), root = path.join(base, "sync");
    await fs.mkdir(root);
    await fs.writeFile(path.join(base, "outside.png"), png());
    await fs.writeFile(path.join(root, "inside.png"), png());
    await fs.symlink(path.join(base, "outside.png"), path.join(root, "outside-link.png"));
    await fs.symlink(path.join(root, "inside.png"), path.join(root, "inside-link.png"));
    await fs.symlink(base, path.join(root, "linked-directory"));
    await fs.symlink(root, path.join(base, "alias"));
    await fs.mkdir(path.join(root, "directory.png"));
    const { loadMedia, mediaSignature } = await state.load("media.js");
    const cases = ["outside-link.png", "inside-link.png", "linked-directory/outside.png", "directory.png"]
      .map(name => ({ file: path.join(root, name), root }));
    cases.push({ file: path.join(base, "alias/inside.png"), root: path.join(base, "alias") });
    for (const entry of cases) {
      const target = { file: entry.file, on: "remote" };
      const error = entry.file.endsWith("directory.png") ? /regular file/ : /symbolic link/;
      await assert.rejects(loadMedia(target, 1, "image", [entry.root]), error);
      await assert.rejects(mediaSignature(target, [entry.root]), error);
    }
    await assert.rejects(fs.access(path.join(state.dir, "app")), { code: "ENOENT" });
  });
}

test("Python validates the format and dimensions before writing either cache", async t => {
  const state = await runtime(t); state.platform = "linux";
  const root = await fs.realpath(state.dir), invalid = path.join(root, "invalid.png");
  const { loadMedia } = await state.load("media.js");
  for (const bytes of [Buffer.from("not an image"), png().map((byte, i) => i >= 16 && i < 20 ? 0 : byte)]) {
    await fs.writeFile(invalid, bytes);
    for (const on of [null, "remote"])
      await assert.rejects(loadMedia({ file: invalid, on }, 1, "image", [root]), /cannot be decoded|Invalid image dimensions/);
    await assert.rejects(fs.access(path.join(state.dir, "app")), { code: "ENOENT" });
  }
});

test("Windows sync copies fail closed before invoking its local-image helper", async t => {
  const state = await runtime(t); state.platform = "windows";
  const { loadMedia, mediaSignature } = await state.load("media.js");
  const target = { file: "C:/Sync/photo.png", on: "remote" };
  await assert.rejects(loadMedia(target, 1, "image", ["C:/Sync"]), /sync roots require a POSIX path/);
  await assert.rejects(mediaSignature(target, ["C:/Sync"]), /sync roots require a POSIX path/);
  assert.equal(state.calls.length, 0);
});

test("PDF preview uses the local page count even when the remote fixture differs", { skip: process.platform !== "darwin" }, async t => {
  const state = await runtime(t), root = await fs.realpath(state.dir), file = path.join(root, "guide.pdf");
  const { loadMedia } = await state.load("media.js"), target = { file, on: "remote" };
  await assert.rejects(loadMedia(target, 1, "pdf", [root]), /Local copy unavailable.*missing/i);
  const local = pdf(2), remote = pdf(1);
  assert.notEqual(local, remote);
  await fs.writeFile(file, local);
  const page = await loadMedia(target, 2, "pdf", [root]);
  assert.equal(page.page, 2);
  assert.equal(page.pages, 2);
  assert.ok((await fs.lstat(path.join(state.dir, "app", page.path))).isFile());
  assert.ok(state.calls.every(call => !call.options?.on));
});

test("only the paired receiver can opt in and revocation invalidates a pending result", async t => {
  const state = await runtime(t); state.platform = "linux";
  const root = await fs.realpath(state.dir), file = path.join(root, "image.png");
  await fs.writeFile(file, png());
  state.props = { previewStack: "files" };
  state.shared["preview-plus.target"] = { s1: { file, on: "remote", localSyncRoots: [root] } };
  const panel = await state.start();
  t.after(() => panel.close());
  assert.match(panel.error, /configure localSyncRoots/);
  assert.equal(state.calls.length, 0);
  state.props.localSyncRoots = [root]; state.render(); await state.settle();
  assert.ok(panel.media);
  assert.ok(state.watches.has(root));
  state.props.localSyncRoots = []; state.render(); await state.settle();
  assert.equal(panel.media, null);
  assert.equal(state.watches.size, 0);
  state.props.localSyncRoots = [root]; state.render(); await state.settle();
  assert.ok(panel.media);

  let finish;
  state.hooks.exec = async command => command === "python3" ? new Promise(resolve => { finish = resolve; }) : undefined;
  panel.reload(state.cx); await until(() => Boolean(finish));
  state.props.localSyncRoots = []; state.render(); await state.settle();
  finish({ code: 0, stdout: JSON.stringify({ path: "mods/preview-plus/.cache/stale.png", width: 1, height: 1, pages: 1 }), stderr: "" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(panel.media, null);
  assert.match(panel.error, /configure localSyncRoots/);
  assert.equal(state.watches.size, 0);
  assert.equal(find(state.render(), "preview-local-copy"), null);

  state.props.localSyncRoots = [root];
  state.shared["preview-plus.target"].s1.file = path.join(root, "note.md");
  state.hooks.read = async (_file, options) => {
    assert.equal(options.on, "remote");
    return "# Remote\n\n![Image](image.png)";
  };
  const calls = state.calls.length;
  state.render(); await state.settle();
  assert.equal(panel.error, null);
  assert.equal(panel.imageWarning, true);
  assert.equal(state.calls.length, calls);
});
