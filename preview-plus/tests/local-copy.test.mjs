import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { runtime, find, until } from "./runtime.mjs";
import { png, pdf } from "./fixtures.mjs";

test("sync roots are explicit absolute directory boundaries, not incoming target permissions", async t => {
  const state = await runtime(t), { syncRoots, localCopyTarget } = await state.load("local-copy.js");
  assert.deepEqual(Array.from(syncRoots(["relative", null, "/sync/./docs/", "/sync/docs", "/bad\0path"])), ["/sync/docs"]);
  const target = { file: "/sync/docs/image.png", on: "remote", root: "/sync", localSyncRoots: ["/sync"] };
  assert.equal(localCopyTarget(target), null);
  assert.equal(localCopyTarget(target, "/sync"), null);
  assert.ok(localCopyTarget(target, ["/sync/docs"]));
  for (const file of ["/sync/docs-other/image.png", "/sync/docs/../private/image.png", "/sync/docs", "/sync/docs/note.md"])
    assert.equal(localCopyTarget({ ...target, file }, ["/sync/docs"]), null);
  assert.equal(localCopyTarget({ ...target, on: null }, ["/sync"]), null);
  assert.ok(localCopyTarget({ file: "C:\\Sync\\photo.PNG", on: "remote" }, ["C:\\Sync"]));
});

for (const platform of ["macos", "linux"]) {
  test(`${platform}: default opt-out and outside-root media do not run local helpers`, async t => {
    const state = await runtime(t); state.platform = platform;
    state.props = { file: path.join(state.dir, "image.png"), on: "remote" };
    await fs.writeFile(state.props.file, png());
    const panel = await state.start();
    assert.match(panel.error, /explicitly configure localSyncRoots/);
    assert.equal(state.calls.length, 0);
    assert.equal(find(state.render(), "preview-local-copy"), null);
    state.props.localSyncRoots = [path.join(state.dir, "other")];
    state.render(); await state.settle();
    assert.equal(panel.media, null); assert.equal(state.calls.length, 0);
    await panel.close();
  });

  test(`${platform}: differing local/remote image bytes preview the local copy with an honest label`, async t => {
    const state = await runtime(t); state.platform = platform;
    const file = path.join(state.dir, "photo ' one.png"), remoteFile = path.join(state.dir, "remote-photo.png");
    const local = png(320, 180), remote = png(180, 320, true);
    await fs.writeFile(file, local); await fs.writeFile(remoteFile, remote);
    assert.notDeepEqual(await fs.readFile(file), await fs.readFile(remoteFile));
    state.props = { file, on: "remote", localSyncRoots: [state.dir] };
    state.hooks.exec = async (_command, _args, options) => { assert.ok(!options.on, "must not read or compare the remote file"); };
    const panel = await state.start();
    assert.equal(panel.error, null); assert.equal(panel.media.localCopy, true);
    assert.equal(panel.media.width, 320); assert.equal(panel.media.height, 180);
    assert.deepEqual(await fs.readFile(path.join(state.dir, "app", panel.media.path)), local);
    assert.equal(panel.selected.on, "remote");
    assert.equal(panel.document, null);
    const tree = state.render(), label = find(tree, "preview-local-copy");
    assert.ok(label); assert.match(label.nodes.join(""), /Local copy.*not remote.*Contents may differ.*not verified/);
    assert.equal(find(tree, "preview-open").handlers.on_click, undefined);
    panel.open(state.cx); await until(() => Boolean(panel.actionError));
    assert.match(panel.actionError, /only available for local/);
    assert.ok(!state.calls.some(call => ["open", "xdg-open", "explorer.exe"].includes(call.command)));
    await panel.close();
  });

  for (const ext of platform === "macos" ? ["png", "pdf"] : ["png"]) {
    test(`${platform}: missing local ${ext} is explicit and recovers without a remote fetch`, async t => {
      const state = await runtime(t); state.platform = platform;
      state.props = { file: path.join(state.dir, `missing.${ext}`), on: "remote", localSyncRoots: [state.dir] };
      const panel = await state.start();
      assert.equal(panel.media, null); assert.match(panel.error, /Local copy unavailable/);
      assert.match(panel.error, /missing|no longer available|cannot be read|No such file/i);
      assert.ok(find(state.render(), "preview-local-copy"));
      await fs.writeFile(state.props.file, ext === "pdf" ? pdf() : png());
      panel.poll(state.cx); await until(() => Boolean(panel.media) && !panel.loading);
      assert.equal(panel.error, null); assert.equal(panel.media.localCopy, true);
      assert.ok(state.calls.every(call => !call.options?.on));
      await panel.close();
    });
  }

  test(`${platform}: symlinks cannot escape an opted-in root, including metadata probes`, async t => {
    const state = await runtime(t); state.platform = platform;
    const root = path.join(state.dir, "sync"), outside = path.join(state.dir, "outside.png");
    await fs.mkdir(root); await fs.writeFile(outside, png());
    await fs.symlink(outside, path.join(root, "escape.png"));
    const { loadMedia, mediaSignature } = await state.load("media.js"), target = { file: path.join(root, "escape.png"), on: "remote" };
    await assert.rejects(loadMedia(target, 1, "image", [root]), /outside the configured sync roots/);
    await assert.rejects(mediaSignature(target, [root]), /outside the configured sync roots/);
    await fs.symlink(state.dir, path.join(root, "directory"));
    await assert.rejects(loadMedia({ file: path.join(root, "directory/outside.png"), on: "remote" }, 1, "image", [root]), /outside the configured sync roots/);
    await fs.writeFile(path.join(root, "inside.png"), png());
    await fs.symlink(path.join(root, "inside.png"), path.join(root, "allowed.png"));
    assert.equal((await loadMedia({ file: path.join(root, "allowed.png"), on: "remote" }, 1, "image", [root])).localCopy, true);
  });
}

test("PDF page count and page navigation use local bytes even when the remote PDF differs", async t => {
  const state = await runtime(t), file = path.join(state.dir, "guide.pdf"), remote = path.join(state.dir, "remote.pdf");
  await fs.writeFile(file, pdf(2)); await fs.writeFile(remote, pdf(1));
  assert.notDeepEqual(await fs.readFile(file), await fs.readFile(remote));
  state.props = { file, on: "remote", localSyncRoots: [state.dir] };
  const panel = await state.start();
  assert.equal(panel.error, null); assert.equal(panel.total, 2); assert.equal(panel.media.localCopy, true);
  panel.turnPage(1, state.cx); await state.settle();
  assert.equal(panel.page, 2); assert.ok(find(state.render(), "preview-local-copy"));
  assert.equal(find(state.render(), "preview-next").handlers.on_click, undefined);
  await panel.close();
});

test("copy watchers and metadata recovery preserve unchanged media and reload local updates/deletions", async t => {
  const state = await runtime(t), file = path.join(state.dir, "image.png");
  await fs.writeFile(file, png());
  state.props = { file, on: "remote", localSyncRoots: [state.dir] };
  const panel = await state.start(), first = panel.media;
  panel.zoom = 1.4; panel.pan = { x: 12, y: 14 };
  panel.poll(state.cx); await until(() => !panel.mediaPoll);
  assert.equal(panel.media, first); assert.equal(panel.zoom, 1.4); assert.equal(panel.pan.x, 12);
  await fs.writeFile(file, png(320, 180, true)); await state.change(state.dir, [file]);
  await until(() => panel.media?.width === 320);
  await fs.rm(file); await state.change(state.dir, [file]);
  await until(() => /Local copy unavailable/.test(panel.error));
  assert.equal(panel.media, null);
  await panel.close();
});

test("paired receiver owns opt-in, revocation invalidates pending copies, remote text stays remote", async t => {
  const state = await runtime(t), file = path.join(state.dir, "image.png");
  await fs.writeFile(file, png());
  state.props = { previewStack: "files", localSyncRoots: [state.dir] };
  state.shared["preview-plus.target"] = { s1: { file, on: "remote" } };
  const panel = await state.start(); assert.equal(panel.media.localCopy, true);
  state.props.localSyncRoots = []; state.render(); await state.settle();
  assert.equal(panel.media, null); assert.match(panel.error, /explicitly configure/);
  assert.equal(state.watches.size, 0);
  const pending = [];
  state.hooks.exec = async command => command === "osascript" ? new Promise(resolve => pending.push(resolve)) : undefined;
  state.props.localSyncRoots = [state.dir]; state.render(); await until(() => pending.length === 1);
  state.props.localSyncRoots = []; state.render(); await state.settle();
  pending[0]({ code: 0, stdout: JSON.stringify({ path: "mods/preview-plus/.cache/stale.png", width: 1, height: 1, pages: 1, page: 1 }), stderr: "" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(panel.media, null); assert.match(panel.error, /explicitly configure/);
  state.props.localSyncRoots = [state.dir];
  state.shared["preview-plus.target"].s1.file = path.join(state.dir, "note.md");
  let readOn;
  state.hooks.read = async (_file, options) => { readOn = options.on; return "# Remote\n\n![Image](image.png)"; };
  state.render(); await state.settle();
  assert.equal(readOn, "remote"); assert.equal(panel.document, null); assert.equal(panel.imageWarning, true);
  assert.equal(find(state.render(), "preview-local-copy"), null);
  await panel.close();
});
