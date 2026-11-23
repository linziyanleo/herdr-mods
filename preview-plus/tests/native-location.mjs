// Run after native-session.mjs --distinct-bundle --background --location.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const info = JSON.parse(await fs.readFile(process.argv[2], "utf8"));
assert.ok(info.base.startsWith("/tmp/pp.") && info.background);
assert.equal(info.env.HERDR_APP_HOME, path.join(info.base, "app"));
const execute = promisify(execFile), env = { ...process.env, ...info.env };
const control = path.join(info.base, "control"), peerControl = path.join(info.base, "peer");
const file = path.join(info.project, "slow-location.md"), other = path.join(info.project, "other.txt");
const read = async (dir = control, name = "state.json") =>
  fs.readFile(path.join(dir, name), "utf8").then(JSON.parse).catch(() => null);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const cli = async (command, args = {}) => JSON.parse((await execute("herdr-app", ["do", command, JSON.stringify(args)], { env })).stdout);
const locate = args => cli("preview-plus-driver.locate:" + encodeURIComponent(JSON.stringify(args)));
const report = [];
async function until(check, label) {
  for (let n = 0; n < 120; n++) {
    const value = await check();
    if (value) return value;
    await pause(50);
  }
  throw new Error(`Timed out: ${label}; state: ${JSON.stringify(await read()).slice(0, 1800)}`);
}
const ready = (label, accept, dir = control) => until(async () => {
  const state = await read(dir);
  return state && !state.loading && !state.error && !state.pendingPosition && accept(state) && state;
}, label);
let serial = 0;
async function request(action, args = {}) {
  const id = `location-${Date.now()}-${++serial}`;
  await fs.writeFile(path.join(control, "request.json"), JSON.stringify({ id, action, ...args }));
  const receipt = await until(async () => {
    const value = await read(control, "receipt.json");
    return value?.id === id && value;
  }, action);
  assert.equal(receipt.error, undefined);
}
const shot = async name => {
  assert.equal((await read()).windowActive, false);
  await execute("herdr-app", ["shot", path.join(info.base, name + ".png")], { env });
};
const saveResult = label => { report.push(label); console.log("passed: " + label); };
const hits = [8, 110, 178];
const rows = Array.from({ length: 190 }, (_, index) => hits.includes(index + 1)
  ? `${index + 1} 中😀e\u0301 public API [literal].*`
  : `${index + 1}  A Source line for preview navigation`);
const text = rows.join("\r\n") + "\r\n";
const needle = "[literal].*", range = at => ({ start: at, end: at + needle.length });
const startAt = line => rows.slice(0, line - 1).join("\r\n").length + (line > 1 ? 2 : 0);
const at = line => startAt(line) + rows[line - 1].indexOf(needle);
const isRange = (value, start, end = start) => value.selection?.start === start && value.selection?.end === end;
await fs.mkdir(peerControl);
await fs.writeFile(file, text);
await fs.writeFile(other, "Different file\r\nNo matching text\r\n");
await cli("layout.set", { layout: { id: "root", type: "block", content: { tab: "active" } } });
const space = info.first.space, viewer = "first-fixed";
const pane = await cli("tab.new", { space, name: "Source navigation", mod: "preview-plus-driver",
  props: { file, space, viewer, base: control, location: { line: 110, column: 5 } } });
const tab = pane.tab, fixed = { file, on: null, space, tab, viewer };
await until(async () => (await read())?.pendingPosition, "open awaits the slow document");
const initial = await ready("initial position", v => v.source && isRange(v, startAt(110) + 4));
assert.equal(initial.codeText, text, "native value preserves CRLF and decomposed Unicode");
await shot("location-open");
saveResult("Fixed props reveal an off-screen CRLF line with the native UTF-16 caret");

await request("navigation", { mode: "go" });
await request("go", { value: "99999" });
await ready("out of range", v => /outside/.test(v.locationError) && isRange(v, startAt(110) + 4));
await request("go", { value: "178:7" });
await ready("go to", v => !v.navigation && isRange(v, startAt(178) + 7));
await request("navigation", { mode: "find" });
await request("find", { value: needle });
await ready("first match", v => v.find?.count === 3 && isRange(v, at(8), at(8) + needle.length));
await shot("location-find-first");
await request("find-step", { delta: -1 });
await ready("wrap backwards", v => v.find?.active === 2 && isRange(v, at(178), at(178) + needle.length));
await shot("location-find-last");
await request("find-step", { delta: 1 });
await ready("wrap forwards", v => v.find?.active === 0 && isRange(v, at(8), at(8) + needle.length));
await request("find", { value: "no such text" });
await ready("zero matches", v => v.find?.count === 0);
await request("navigation-close");
assert.equal((await read()).editorCount, initial.editorCount);
saveResult("Native range readback confirms literal find, zero/three matches, wrap and retained editor state");

await cli("pane.split", { direction: "right", mod: "preview-plus-driver", props: { file, space, viewer: "peer-fixed", base: peerControl } });
await ready("other viewer", v => v.codeText === text && !v.source && isRange(v, 0), peerControl);
const draft = "Unsaved line\r\n" + text;
await request("edit", { value: draft });
const dirty = await ready("draft", v => v.dirty && v.codeText === draft);
await locate({ ...fixed, location: { line: 110, column: 21, expectedLine: rows[109], match: needle } });
await ready("changed source warning", v => /verified/.test(v.locationError) && isRange(v, dirty.selection.start, dirty.selection.end));
await locate({ ...fixed, on: "fixture-remote", location: { line: 1 } });
await locate({ ...fixed, space: "another-workspace", location: { line: 1 } });
await locate({ ...fixed, tab: "another-tab", location: { line: 1 } });
await locate({ ...fixed, location: { line: 111, column: 21, expectedLine: rows[109], match: needle } });
const selected = at(110) + "Unsaved line\r\n".length;
const reused = await ready("reused draft match", v => v.dirty && isRange(v, selected, selected + needle.length));
assert.equal(reused.editorCount, initial.editorCount);
assert.deepEqual((await read(peerControl)).selection, { start: 0, end: 0 });
assert.equal(draft.slice(...Object.values(range(selected))), needle);
await request("replace", { value: "replacement" });
const replaced = draft.slice(0, selected) + "replacement" + draft.slice(selected + needle.length);
await ready("native replace uses the selected range", v => v.dirty && v.codeText === replaced);
assert.equal(await fs.readFile(file, "utf8"), text);
saveResult("Scoped native command reuses one viewer and selects a verified draft match for native editing");

await cli("tab.select", { id: info.first.tab });
await fs.rm(path.join(control, "request.json"), { force: true });
const stack = "preview-location-stack";
await cli("layout.set", { layout: { id: "root", type: "block",
  content: { mod: "preview-plus-driver", props: { previewStack: stack, base: control } } } });
await ready("paired slot", v => v.owner?.mode === "paired");
const paired = { space, tab: info.first.tab, stack };
async function pair(file, on, selection) {
  await request("pair-target", { space, target: { file, on, selection } });
}
await pair(file, null, "old-a");
await until(async () => (await read())?.loading, "old slow A");
await locate({ ...paired, file, on: null, selection: "old-a", location: { line: 8 } });
await pair(other, null, "b");
await ready("B ready", v => v.selected?.file === other);
await pair(file, "fixture-remote", "new-a");
await locate({ ...paired, file, on: "fixture-remote", selection: "new-a", location: { line: 178 } });
await locate({ ...paired, file, on: "fixture-remote", selection: "old-a", location: { line: 2 } });
const remote = await ready("only latest A applies", v => v.selected?.on === "fixture-remote" && isRange(v, startAt(178)));
assert.equal(remote.document, null);
await request("pin");
await pair(other, "fixture-remote", "blocked-b");
await locate({ ...paired, file: other, on: "fixture-remote", selection: "blocked-b", location: { line: 2 } });
await ready("pin retains same source", v => v.pinned && v.selected?.file === file && isRange(v, startAt(178)));
await request("navigation", { mode: "find" });
await request("find", { value: needle });
await ready("read-only native selection", v => v.document === null && v.find?.count === 3 && isRange(v, at(8), at(8) + needle.length));
saveResult("Paired slow A→B→A, pins and native selection on simulated remote read-only text");

const status = JSON.parse((await execute("herdr-app", ["status"], { env })).stdout);
assert.deepEqual(status.errors, []);
await fs.writeFile(path.join(info.base, "native-location-report.json"), JSON.stringify({ report, errors: status.errors }, null, 2));
console.log(info.base);
