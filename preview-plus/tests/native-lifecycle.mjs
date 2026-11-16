// Run after native-session.mjs --distinct-bundle --lifecycle. Never uses the daily home.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const info = JSON.parse(await fs.readFile(process.argv[2], "utf8"));
assert.ok(info.base.startsWith("/tmp/pp."));
assert.equal(info.env.HERDR_APP_HOME, path.join(info.base, "app"));
const execute = promisify(execFile), env = { ...process.env, ...info.env };
const cli = async (name, args) => JSON.parse((await execute("herdr-app", ["do", name, JSON.stringify(args || {})], { env })).stdout);
const control = path.join(info.base, "control"), peerControl = path.join(info.base, "peer");
await fs.mkdir(peerControl, { recursive: true });
const read = async (base = control) => JSON.parse(await fs.readFile(path.join(base, "state.json"), "utf8"));
async function until(check, label) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error(`Timed out: ${label}`);
}
let serial = 0;
async function request(action, args = {}) {
  const id = `${Date.now()}-${++serial}`;
  await fs.writeFile(path.join(control, "request.json"), JSON.stringify({ id, action, ...args }));
  await until(async () => {
    const receipt = await fs.readFile(path.join(control, "receipt.json"), "utf8").then(JSON.parse).catch(() => null);
    if (receipt?.id !== id) return false;
    assert.equal(receipt.error, undefined); return receipt;
  }, action);
}
const records = [];
await cli("layout.set", { layout: { id: "root", type: "block", content: { tab: "active" } } });
const slow = path.join(info.project, "slow.txt"); await fs.writeFile(slow, "Slow A\n");
await fs.rm(path.join(control, "request.json"), { force: true });
const preview = await cli("tab.new", { space: info.first.space, name: "Lifecycle A", mod: "preview-plus-driver", props: { file: slow, root: info.project, base: control } });
await until(async () => { const value = await read(); return value.loading && value.selected?.file === slow; }, "slow read started");
const other = await cli("space.new", { name: "Lifecycle B", folder: info.project, argv: ["/bin/zsh", "-f"] });
await until(async () => { const value = await read(); return !value.loading && value.text === "Slow A\n"; }, "background fixed-file read");
await cli("space.select", { id: info.first.space });
await request("edit", { value: "Dirty A\n" });
await cli("space.select", { id: other.space }); await cli("space.select", { id: info.first.space });
await until(async () => (await read()).codeText === "Dirty A\n", "dirty A-B-A");
records.push({ check: "1s slow fixed-file A-B-A, background completion and dirty draft", result: "pass" });

let last;
for (let index = 0; index < 100; index++) {
  const dir = path.join(info.project, `visit-${index}`); await fs.mkdir(dir, { recursive: true });
  last = path.join(dir, "file.txt"); await fs.writeFile(last, `Directory ${index}\n`);
  await request("show", { file: last, root: dir });
  const value = await until(async () => { const value = await read(); return !value.loading && value.selected?.file === last && value.text === `Directory ${index}\n` && value; }, `directory ${index}`);
  assert.equal(value.watchers, 1); assert.equal(value.watchStats.active, 1); assert.equal(value.watchStats.errors, 0);
}
records.push({ check: "100 distinct native watch directories", result: "pass", stats: (await read()).watchStats });
const beforeFresh = (await read()).watchStats.events;
await fs.writeFile(last, "Fresh callback after 100 directories\n");
await until(async () => { const value = await read(); return value.text === "Fresh callback after 100 directories\n" && value.watchStats.events > beforeFresh; }, "fresh Preview callback before fallback");
records.push({ check: "Preview: fresh callback after 100 directories before 8s deadline", result: "pass", eventsBefore: beforeFresh, eventsAfter: (await read()).watchStats.events });
const peer = await cli("pane.split", { direction: "right", mod: "preview-plus-driver", props: { file: last, root: path.dirname(last), base: peerControl } });
await until(async () => { const value = await read(peerControl).catch(() => null); return !value?.loading && value?.text === "Fresh callback after 100 directories\n"; }, "second pane");
assert.equal((await read()).watchStats.active, 2);
await cli("pane.close", { pane: peer.pane });
const beforePeer = (await read()).watchStats.events;
await fs.writeFile(last, "Peer still refreshes\n");
const remaining = await until(async () => { const value = await read(); return value.text === "Peer still refreshes\n" && value.watchStats.active === 1 && value.watchStats.events > beforePeer && value; }, "independent peer callback before fallback");
assert.equal(remaining.watchStats.errors, 0);
records.push({ check: "two panes, same directory; close one and externally edit", result: "pass", stats: remaining.watchStats });
await cli("tab.select", { id: info.first.tab });
await cli("tab.close", { id: preview.tab, confirmed: true });

const filesBase = path.join(info.base, "files-lifecycle"), filesPeer = path.join(info.base, "files-peer");
await fs.mkdir(filesBase, { recursive: true }); await fs.mkdir(filesPeer, { recursive: true });
const filesState = async (base = filesBase) => JSON.parse(await fs.readFile(path.join(base, "native-state-panel.json"), "utf8"));
const files = await cli("tab.new", { space: info.first.space, name: "Files lifecycle", mod: "files-plus", props: { base: filesBase, owner: false, driverMod: "files-plus" } });
await until(async () => (await filesState().catch(() => null))?.watchers === 1, "Files initial watch");
async function filesRequest(value, accept) {
  await fs.rm(path.join(filesBase, "receipt.json"), { force: true });
  await fs.writeFile(path.join(filesBase, "request.json"), JSON.stringify(value));
  await cli("files-plus.test");
  return until(async () => {
    const receipt = await fs.readFile(path.join(filesBase, "receipt.json"), "utf8").then(JSON.parse).catch(() => null);
    if (!receipt) return false;
    assert.equal(receipt.error, undefined);
    const value = await filesState(); return accept(value) && value;
  }, `Files ${value.type}`);
}
for (let index = 0; index < 100; index++) {
  const dir = path.join(info.project, `visit-${index}`);
  const value = await filesRequest({ type: "browse-folder", path: dir }, value => value.entries[dir] && value.watchStats?.active === 1);
  assert.equal(value.watchStats.errors, 0); last = dir;
}
records.push({ check: "Files: 100 distinct native watch directories", result: "pass", stats: (await filesState()).watchStats });
const filesFresh = (await filesState()).watchStats.events;
await fs.writeFile(path.join(last, "after-100.txt"), "Fresh Files callback\n");
await until(async () => { const value = await filesState(); return value.entries[last]?.some(entry => entry.name === "after-100.txt") && value.watchStats.events > filesFresh; }, "fresh Files callback before fallback");
records.push({ check: "Files: fresh callback after 100 directories before 8s deadline", result: "pass", eventsBefore: filesFresh, eventsAfter: (await filesState()).watchStats.events });
const filesSecond = await cli("pane.split", { direction: "right", mod: "files-plus", props: { base: filesPeer, owner: false, driverMod: "files-plus" } });
await until(async () => (await filesState(filesPeer).catch(() => null))?.watchStats?.active === 2, "Files peer watch");
await cli("pane.close", { pane: filesSecond.pane });
const filesBeforePeer = (await filesState()).watchStats.events;
await fs.writeFile(path.join(last, "peer-added.txt"), "Remaining Files pane\n");
const filesRemaining = await until(async () => { const value = await filesState(); return value.watchStats.active === 1 && value.watchStats.events > filesBeforePeer && value.entries[last]?.some(entry => entry.name === "peer-added.txt") && value; }, "remaining Files peer callback before fallback");
assert.equal(filesRemaining.watchStats.errors, 0);
records.push({ check: "Files: close same-directory peer then create file", result: "pass", stats: filesRemaining.watchStats });
const collapsed = await filesRequest({ type: "toggle", path: last }, value => value.watchStats.active === 0);
await new Promise(resolve => setTimeout(resolve, 250));
assert.equal((await filesState()).watchStats.started, collapsed.watchStats.started);
await filesRequest({ type: "toggle", path: last }, value => value.watchStats.active === 1 && value.entries[last]);
records.push({ check: "Files: collapse cancels without empty-result hot loop; reopen registers once", result: "pass" });
await cli("tab.select", { id: info.first.tab }); await cli("tab.close", { id: files.tab, confirmed: true });
const status = JSON.parse((await execute("herdr-app", ["status"], { env })).stdout);
assert.deepEqual(status.errors, []);
if (!info.background) await execute("herdr-app", ["shot", path.join(info.base, "lifecycle-final.png")], { env });
if (info.background) { assert.equal(remaining.windowActive, false); assert.equal(filesRemaining.windowActive, false); }
await fs.writeFile(path.join(info.base, "lifecycle-report.json"), JSON.stringify({ host: "Herdr 0.1.16", records, status, background: info.background, windowActive: { preview: remaining.windowActive, files: filesRemaining.windowActive } }, null, 2));
console.log(JSON.stringify(records, null, 2));
