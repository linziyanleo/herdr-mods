// Verify the paired stack against a minimal native receiver, not a rich renderer.
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile), info = JSON.parse(await fs.readFile(process.argv[2], "utf8"));
assert.ok(info.base.startsWith("/tmp/fp."));
const env = { ...process.env, ...info.env }, base = info.base, app = info.app;
const command = async (name, args = {}) => JSON.parse((await execute("herdr-app", ["do", name, JSON.stringify(args)], { env })).stdout);
async function until(read, accept) {
  for (let n = 0; n < 100; n++) {
    try { const value = await read(); if (accept(value)) return value; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for native paired preview");
}
async function request(value) {
  await fs.rm(path.join(base, "receipt.json"), { force: true });
  await fs.writeFile(path.join(base, "request.json"), JSON.stringify(value));
  await command("files-plus-driver.test");
  const receipt = await until(async () => JSON.parse(await fs.readFile(path.join(base, "receipt.json"), "utf8")), () => true);
  assert.equal(receipt.error, undefined);
}
const receiver = path.join(app, "mods/preview-plus");
await fs.mkdir(receiver);
await fs.writeFile(path.join(receiver, "mod.json"), '{"place":"none"}');
await fs.writeFile(path.join(receiver, "main.js"), `import { View, div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { props, spaces, shared, nextCommand, run, readTextFile, writeTextFile } from "herdr";
export default class Receiver extends View {
  init(p, cx) {
    cx.timer.every(100, cx => { const target = shared("preview-plus.target")?.[spaces().find(s => s.active)?.id]; const text = JSON.stringify(target || null);
      if (text !== this.last) { this.last = text; cx.spawn(async () => { const file = props().base + "/paired-target.json"; await writeTextFile(file, text, await readTextFile(file)); }); }
    });
    cx.spawn(async () => { for (;;) { await nextCommand(); run("layout.select", { stack: "files", child: "files-plus-tree" }); } });
  }
  render() { return v_flex().size_full().p(12).child(div().child("Native preview receiver fixture")).child(div().child(shared("preview-plus.target")?.[spaces().find(s => s.active)?.id]?.file || "")); }
}`);
const layout = { id: "root", type: "column", children: [{ id: "tabs", type: "block", size: { px: 38 }, content: { mod: "tabs" } }, { id: "body", type: "row", children: [
  { id: "terminal", type: "block", content: { tab: "active" } },
  { id: "files", type: "stack", size: { px: 420 }, active: "files-plus-tree", children: [
    { id: "files-plus-tree", type: "block", content: { mod: "files-plus-driver", props: { base, previewStack: "files" } } },
    { id: "preview-plus", type: "block", content: { mod: "preview-plus", props: { base, previewStack: "files" } } }
  ] }
] }] };
await command("overlay.close"); await command("layout.set", { layout });
const web = path.dirname(info.workspace) + "/web", folder = web + "/src";
await request({ type: "workspace", file: info.workspace });
await until(async () => JSON.parse(await fs.readFile(path.join(base, "native-state-panel.json"), "utf8")), value => Boolean(value.entries[web]));
await request({ type: "toggle", path: folder });
for (const ext of ["md", "png", "pdf"]) {
  const file = `${web}/paired-target.${ext}`; await fs.writeFile(file, "Disposable target fixture\n");
  await fs.rm(path.join(base, "paired-target.json"), { force: true });
  await request({ type: "preview", path: file, root: web });
  const target = await until(async () => JSON.parse(await fs.readFile(path.join(base, "paired-target.json"), "utf8")), value => value?.file === file);
  assert.deepEqual(target, { file, root: web, on: null });
  await command("preview-plus.back");
  // The driver only receives commands while the source stack child is shown.
  await request({ type: "snapshot" });
  const state = JSON.parse(await fs.readFile(path.join(base, "native-state-panel.json"), "utf8"));
  assert.ok(state.folders.includes(folder));
  console.log(`passed: native .${ext} target handoff, back command and retained expansion`);
}
const text = web + "/paired-source.txt"; await fs.writeFile(text, "Source stays in Files Plus\n");
await request({ type: "preview", path: text, root: web });
await until(async () => JSON.parse(await fs.readFile(path.join(base, "native-state-panel.json"), "utf8")), value => value.file === text && value.preview);
const status = JSON.parse((await execute("herdr-app", ["status"], { env })).stdout); assert.deepEqual(status.errors, []);
await fs.writeFile(path.join(base, "native-pair-report.json"), JSON.stringify({ formats: ["md", "png", "pdf"], source: "txt", expansionRetained: true, errors: status.errors, receiver: "Minimal native contract fixture; Preview Plus rendering is not implemented here." }, null, 2));
await request({ type: "back" });
console.log(`passed: ordinary text remains in Files Plus; report: ${base}/native-pair-report.json`);
