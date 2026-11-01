// Drives the real GPUI views and Herdr APIs in native-session.mjs's disposable home.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execute = promisify(execFile), info = JSON.parse(await fs.readFile(process.argv[2], "utf8"));
assert.ok(info.base.startsWith("/tmp/fp."), "Use a session created by native-session.mjs");
const env = { ...process.env, ...info.env }, base = info.base, app = info.app;
const source = fileURLToPath(new URL("../mods/files-plus", import.meta.url));
const runtimeFile = entry => !["jsconfig.json", "gpui-kit.d.ts", "herdr.d.ts"].includes(path.basename(entry));
await fs.cp(source, path.join(app, "mods/files-plus"), { recursive: true, filter: runtimeFile });
const driver = path.join(app, "mods/files-plus-driver");
await fs.cp(source, driver, { recursive: true, filter: runtimeFile });
await fs.rename(path.join(driver, "main.js"), path.join(driver, "panel.js"));
await fs.copyFile(fileURLToPath(new URL("native-driver.js", import.meta.url)), path.join(driver, "main.js"));
await fs.writeFile(path.join(driver, "mod.json"), '{"place":"none"}');
const command = async (name, args = {}) => JSON.parse((await execute("herdr-app", ["do", name, JSON.stringify(args)], { env })).stdout);
const status = async () => JSON.parse((await execute("herdr-app", ["status"], { env })).stdout);
const model = async () => JSON.parse((await execute("herdr-app", ["ls"], { env })).stdout);
const shared = async () => {
  const values = JSON.parse(await fs.readFile(path.join(app, "shared.json"), "utf8"));
  const snapshots = {};
  for (const name of (await fs.readdir(base)).filter(name => name.startsWith("native-state-") && name.endsWith(".json"))) snapshots[name.slice(13, -5)] = JSON.parse(await fs.readFile(path.join(base, name), "utf8"));
  values["files-plus.test"] = snapshots;
  if (snapshots.panel) values["multi-root.spaces"] = snapshots.panel.workspaces;
  return values;
};
async function until(read, predicate, description) {
  let result;
  for (let n = 0; n < 100; n++) {
    try { result = await read(); if (predicate(result)) return result; } catch (error) { if (n === 99) throw error; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${description}. Last value: ${JSON.stringify(result).slice(0, 1000)}`);
}
let sequence = 0, opened;
async function request(value, expectError = false) {
  await fs.rm(path.join(base, "receipt.json"), { force: true });
  await fs.writeFile(path.join(base, "request.json"), JSON.stringify({ ...value, sequence: ++sequence }));
  await command("files-plus-driver.test");
  const reply = await until(async () => JSON.parse(await fs.readFile(path.join(base, "receipt.json"), "utf8")), () => true, "native driver receipt");
  if (!expectError) assert.equal(reply.error, undefined, JSON.stringify(reply));
  if (reply.overlay) opened = reply.overlay;
  return reply;
}
async function overlaysClosed() { return until(status, value => !value.overlays.length, "overlay completion"); }
async function closeOverlays() { for (const _ of (await status()).overlays) await command("overlay.close"); }
async function failure() {
  const current = await until(shared, value => value["files-plus.test"]?.[opened]?.error && !value["files-plus.test"][opened].busy, "action error");
  const value = current["files-plus.test"][opened];
  assert.ok(value, "The active dialog must show its error");
  return value.error;
}
const screenshots = [];
async function shot(name) {
  const file = path.join(base, `${name}.png`); await execute("herdr-app", ["shot", file], { env }); screenshots.push(file);
}
const cases = [];
async function check(name, body) { await body(); cases.push(name); console.log(`passed: ${name}`); }
const web = path.dirname(info.workspace) + "/web", api = path.dirname(info.workspace) + "/api", webPhysical = await fs.realpath(web);
const layout = { id: "root", type: "column", children: [{ id: "tabs", type: "block", size: { px: 38 }, content: { mod: "tabs" } }, { id: "body", type: "row", children: [
  { id: "terminal", type: "block", content: { tab: "active" } }, { id: "files", type: "block", size: { px: 420 }, content: { mod: "files-plus-driver", props: { base } } }
] }] };
await command("layout.set", { layout }); await closeOverlays();
await until(shared, value => Boolean(value["files-plus.test"]?.panel), "panel started");
const recordings = {};
for (const [name, folder] of [["web", web], ["api", api]]) {
  const file = path.join(base, `input-${name}-${Date.now()}.bin`);
  const program = 'import os,sys,tty\ntty.setraw(0)\nf=open(sys.argv[1],"wb",buffering=0)\nprint("Files Plus input recorder",flush=True)\nwhile True:\n b=os.read(0,4096)\n if not b: break\n f.write(b)\n';
  const tab = await command("tab.new", { space: info.first.space, name: name === "web" ? "Web recorder" : "API recorder", folder, argv: ["python3", "-u", "-c", program, file] });
  recordings[name] = { ...tab, file };
  await until(() => fs.stat(file), () => true, `${name} recorder ready`);
}
await command("tab.select", { id: recordings.web.tab });
await request({ type: "workspace", file: null });
await request({ type: "clipboard-start" });

try {
  await check("single-folder tree and native New file dialog", async () => {
    await request({ type: "dialog", action: "new-file", path: webPhysical, root: webPhysical, kind: "dir", submit: true, name: "native file.txt" });
    await overlaysClosed();
    assert.equal(await fs.readFile(path.join(web, "native file.txt"), "utf8"), "");
    await until(shared, value => value["files-plus.test"].panel.entries[webPhysical]?.some(e => e.name === "native file.txt"), "tree mutation refresh");
  });
  await check("native rename, name collision error and cancel", async () => {
    await fs.writeFile(path.join(web, "native file.txt"), "preserve these bytes");
    await request({ type: "dialog", action: "rename", path: webPhysical + "/native file.txt", root: webPhysical, submit: true, name: "native renamed.txt" }); await overlaysClosed();
    await request({ type: "dialog", action: "rename", path: webPhysical + "/native renamed.txt", root: webPhysical, submit: true, name: "README.md" });
    assert.match(await failure(), /already exists/); await shot("name-error"); await closeOverlays();
    assert.equal(await fs.readFile(path.join(web, "native renamed.txt"), "utf8"), "preserve these bytes");
  });
  await check("native folder creation and collision-safe Copy/Paste", async () => {
    await request({ type: "dialog", action: "new-folder", path: webPhysical, root: webPhysical, kind: "dir", submit: true, name: "native folder" }); await overlaysClosed();
    await request({ type: "menu", choose: "copy", path: webPhysical + "/native renamed.txt", root: webPhysical }); await overlaysClosed();
    await request({ type: "menu", choose: "paste", path: webPhysical + "/native renamed.txt", root: webPhysical }); await overlaysClosed();
    assert.equal(await fs.readFile(path.join(web, "native renamed copy.txt"), "utf8"), "preserve these bytes");
    await request({ type: "menu", choose: "paste", path: webPhysical + "/native folder", root: webPhysical, kind: "dir" }); await overlaysClosed();
    assert.equal(await fs.readFile(path.join(web, "native folder/native renamed.txt"), "utf8"), "preserve these bytes");
  });
  await check("native directory-cycle refusal", async () => {
    await request({ type: "menu", choose: "copy", path: webPhysical + "/native folder", root: webPhysical, kind: "dir" }); await overlaysClosed();
    await request({ type: "menu", choose: "paste", path: webPhysical + "/native folder", root: webPhysical, kind: "dir" });
    assert.match(await failure(), /itself or a descendant/); await shot("cycle-error"); await closeOverlays();
  });
  await check("native clipboard absolute and owning-root-relative paths", async () => {
    for (const [choose, expected] of [["path", webPhysical + "/native renamed.txt"], ["relative", "native renamed.txt"]]) {
      await request({ type: "menu", choose, path: webPhysical + "/native renamed.txt", root: webPhysical }); await overlaysClosed();
      assert.equal((await request({ type: "snapshot" })).clipboard, expected);
    }
  });
  await check("standalone Markdown source preview and return", async () => {
    await request({ type: "preview", path: webPhysical + "/README.md", root: webPhysical });
    await until(shared, value => Boolean(value["files-plus.test"].panel.preview), "native Editor preview");
    await shot("source-preview"); await request({ type: "back" });
  });
  await check("saved Multi-Roots browsing and preservation across terminal focus", async () => {
    await request({ type: "workspace", file: info.workspace });
    await until(shared, value => value["files-plus.test"].panel.entries[api]?.length > 0, "both roots loaded");
    await request({ type: "toggle", path: web + "/src" });
    await command("tab.select", { id: recordings.api.tab });
    const state = await until(shared, value => value["files-plus.test"].panel.folders.includes(web + "/src"), "expanded folder retained");
    assert.equal(state["multi-root.spaces"][info.first.space].file, info.workspace);
    await shot("multi-root-tree");
  });
  await check("native @ insertion uses captured same-root/cross-root terminals without Enter", async () => {
    // Set a known clipboard after the earlier copy-path tests.
    await request({ type: "clipboard-restore" }); await request({ type: "clipboard-start" });
    for (const [name, expected] of [["web", '@"docs/notes with spaces.md" '], ["api", `@"${web}/docs/notes with spaces.md" `]]) {
      await command("tab.select", { id: recordings[name].tab });
      await request({ type: "menu", choose: "agent", path: web + "/docs/notes with spaces.md", root: web }); await overlaysClosed();
      const bytes = await until(() => fs.readFile(recordings[name].file, "utf8"), value => value.length > 0, "terminal received reference");
      assert.equal(bytes, expected); assert.ok(!/[\r\n]/.test(bytes));
      assert.equal((await request({ type: "snapshot" })).clipboard, "files-plus clipboard baseline");
    }
  });
  await check("native Add folder button and popup/dialog rendering", async () => {
    await request({ type: "dialog", action: "add-root", path: web, root: web, kind: "root" });
    await until(shared, value => Object.values(value["files-plus.test"]).some(v => v.role === "dialog" && !v.error), "add dialog visible");
    await shot("add-folder-dialog"); await closeOverlays();
    await request({ type: "menu", path: web, root: web, kind: "root" });
    await until(shared, value => value["files-plus.test"]?.[opened]?.role === "menu", "menu rendered");
    await shot("root-menu"); await closeOverlays();
  });
  await check("native workspace writes preserve unknown fields and reject conflicts", async () => {
    const extra = path.dirname(info.workspace) + "/extra"; await fs.mkdir(extra);
    await request({ type: "change-roots", action: "add-root", path: extra, root: web });
    const raw = JSON.parse(await fs.readFile(info.workspace, "utf8"));
    assert.equal(raw.custom, "preserved"); assert.equal(raw.folders[0].keep, true); assert.equal(raw.folders[0].path, "web"); assert.equal(raw.folders[2].path, "extra");
    await request({ type: "change-roots", action: "remove-root", root: extra });
    await request({ type: "roots-snapshot", root: web });
    const external = JSON.stringify({ ...raw, custom: "external edit" }, null, 2) + "\n"; await fs.writeFile(info.workspace, external);
    assert.match((await request({ type: "change-roots", action: "add-root", path: extra + "/another", root: web }, true)).error, /changed on disk|workspace changed/);
    assert.equal(await fs.readFile(info.workspace, "utf8"), external);
  });
  await check("native Move to Trash and Finder reveal", async () => {
    const name = `files-plus-native-${Date.now()}.txt`, file = path.join(web, name);
    await fs.writeFile(file, "disposable test file");
    await request({ type: "dialog", action: "trash", path: file, root: web, submit: true }); await overlaysClosed();
    const trashed = path.join(os.homedir(), ".Trash", name);
    assert.equal(await fs.readFile(trashed, "utf8"), "disposable test file");
    await fs.rename(trashed, file); // Restore only this test-created entry.
    await request({ type: "menu", choose: "reveal", path: web + "/README.md", root: web }); await overlaysClosed();
  });
  await check("workspace root launches a terminal without requiring Multi-Roots", async () => {
    const count = (await model()).spaces[0].tabs.length;
    await request({ type: "menu", choose: "new-here", path: api, root: api, kind: "root" }); await overlaysClosed();
    await until(model, value => value.spaces[0].tabs.length === count + 1, "new terminal in root");
    await command("tab.select", { id: recordings.web.tab });
  });
} finally { await closeOverlays(); await request({ type: "clipboard-restore" }); }

const finalStatus = await status(); assert.deepEqual(finalStatus.errors, []);
await execute("herdr-app", ["check", path.join(app, "mods/files-plus")], { env });
const report = { appVersion: (await execute("herdr-app", ["--version"])).stdout.trim(), cases, screenshots, errors: finalStatus.errors, limitations: ["Native folder picker selection and cancellation require manual interaction; helper success/cancel/conflict paths are automated.", "Preview Plus rich rendering is outside Files Plus. Its target contract is covered by automated panel tests.", "Remote machines and Windows/Linux are not available for native verification."] };
await fs.writeFile(path.join(base, "native-report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ passed: cases.length, report: path.join(base, "native-report.json") }));
