import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute = promisify(execFile), info = JSON.parse(await fs.readFile(process.argv[2], "utf8"));
assert.ok(info.base.startsWith("/tmp/fp."));
assert.equal(path.resolve(info.app), path.resolve(info.base, "app"));
assert.equal(path.resolve(info.env.HERDR_APP_HOME), path.resolve(info.app));
const env = { ...process.env, ...info.env };
const cli = (args) => execute("herdr-app", args, { env });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
for (const mod of ["files-plus", "files-plus-driver"]) {
  for (const file of ["workspace.js", "browsing.js", "fit.js"]) await fs.copyFile(new URL(`../mods/files-plus/${file}`, import.meta.url), path.join(info.app, "mods", mod, file));
  await fs.copyFile(new URL("native-driver.js", import.meta.url), path.join(info.app, "mods", mod, "main.js"));
}
await wait(1500);
const state = async () => JSON.parse(await fs.readFile(path.join(info.base, "native-state-panel.json"), "utf8"));
async function request(value, predicate) {
  await fs.rm(path.join(info.base, "receipt.json"), { force: true });
  await fs.writeFile(path.join(info.base, "request.json"), JSON.stringify(value));
  await cli(["do", "files-plus-driver.test", "{}"]);
  for (let i = 0; i < 100; i++) {
    try { const receipt = JSON.parse(await fs.readFile(path.join(info.base, "receipt.json"), "utf8")); assert.equal(receipt.error, undefined); const result = await state(); if (predicate(result)) return result; } catch (error) { if (i === 99) throw error; }
    await wait(100);
  }
  throw new Error("Native browsing state did not settle");
}
await request({ type: "browse-reset" }, s => !s.location.browsing);
await request({ type: "workspace" }, s => !s.location.entry);
const before = await state(), folder = path.join(info.base, "project/web");
const browsed = await request({ type: "browse-folder", path: folder }, s => s.location.browsing === folder && Boolean(s.entries[folder]));
assert.deepEqual(browsed.workspaces, before.workspaces);
await request({ type: "activate" }, () => true); await wait(1000);
await cli(["shot", path.join(info.base, "browsing-frame-warmup.png")]); await wait(1000);
await cli(["shot", path.join(info.base, "browsing-override.png")]);
const reset = await request({ type: "browse-reset" }, s => !s.location.browsing);
assert.deepEqual(reset.workspaces, before.workspaces);
await request({ type: "workspace", file: info.workspace }, s => Boolean(s.location.entry));
const workspace = await state();
await request({ type: "browse-folder", path: folder }, s => s.location.browsing === folder && !s.location.entry);
const restored = await request({ type: "browse-reset" }, s => s.location.entry?.folders.length === 2);
assert.deepEqual(restored.workspaces, workspace.workspaces);
await request({ type: "activate" }, () => true); await wait(1000);
await cli(["shot", path.join(info.base, "browsing-frame-warmup.png")]); await wait(1000);
await cli(["shot", path.join(info.base, "browsing-workspace-restored.png")]);
console.log("Native browsing override and reset passed for single-folder and multi-root spaces. Picker interaction is not simulated.");
