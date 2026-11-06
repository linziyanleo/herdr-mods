// Serial acceptance against an already authorized disposable native-session.
// This script never starts hc; the caller owns that session and its cleanup.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile), info = JSON.parse(await fs.readFile(process.argv[2], "utf8"));
assert.ok(info.base.startsWith("/tmp/pp."));
const env = { ...process.env, ...info.env }, control = path.join(info.base, "control"), reports = [];
const command = async (name, args = {}) => JSON.parse((await execute("herdr-app", ["do", name, JSON.stringify(args)], { env })).stdout);
const state = async () => JSON.parse(await fs.readFile(path.join(control, "state.json"), "utf8"));
async function until(read, accept, label) {
  for (let n = 0; n < 160; n++) {
    let value; try { value = await read(); } catch {}
    if (value && accept(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Timed out: " + label + "\n" + JSON.stringify(await state()));
}
async function request(value) {
  const id = `${Date.now()}-${Math.random()}`;
  await fs.writeFile(path.join(control, "request.json"), JSON.stringify({ ...value, id }));
  const receipt = await until(async () => JSON.parse(await fs.readFile(path.join(control, "receipt.json"), "utf8")), v => v.id === id, value.action);
  assert.equal(receipt.error, undefined);
}
const ready = (accept, label) => until(state, value => !value.loading && !value.markdownBusy && !value.error && accept(value), label);
const shot = async name => { await request({ action: "activate" }); await execute("herdr-app", ["shot", path.join(info.base, name + ".png")], { env }); };
const passed = label => { reports.push(label); console.log("passed: " + label); };
const file = name => path.join(info.project, name);
const previousDriver = (await state().catch(() => null))?.driverIdentity;
await fs.rm(path.join(control, "request.json"), { force: true });
await command("layout.set", { layout: { id: "root", type: "block", content: { mod: "preview-plus-driver", props: { base: control, file: file("community.md") } } } });
await until(state, v => v.driverIdentity && v.driverIdentity !== previousDriver && v.owner?.target?.file === file("community.md"), "new Preview driver");
await request({ action: "activate" });
let current = await ready(v => v.selected?.file === file("community.md") && v.markdownBlocks?.filter(b => b.diagram && b.media).length === 2, "native Mermaid");
assert.equal(current.markdownBlocks.filter(b => b.diagram && b.error).length, 1);
await request({ action: "contents" }); await ready(v => v.contents, "contents"); await shot("rich-markdown");
await request({ action: "follow", href: "#details-1" }); await ready(v => v.anchor === "details-1", "duplicate heading"); await shot("rich-anchor");
await request({ action: "follow", href: "notes/anchors.md#中文-标题" }); await ready(v => v.anchor === "中文-标题", "cross-document anchor");
await request({ action: "back" }); await ready(v => v.anchor === "details-1" && v.selected.file === file("community.md"), "restore anchor");
await request({ action: "source", value: true });
const original = current.text, draft = original + "\n## Unsaved heading\nDraft text.\n";
await request({ action: "edit", value: draft }); await request({ action: "source", value: false });
await ready(v => v.dirty && v.headings?.some(h => h.slug === "unsaved-heading"), "draft headings");
assert.equal(await fs.readFile(file("community.md"), "utf8"), original);
await request({ action: "follow", href: "#unsaved-heading" }); await ready(v => v.anchor === "unsaved-heading", "draft anchor");
await shot("rich-draft");
await request({ action: "discard" }); await request({ action: "discard" }); await ready(v => !v.dirty, "discard draft");
passed("Native Mermaid images/error source, contents, duplicate/Unicode anchors, history and unsaved heading safety");

for (const [name, rows] of [["data.json", 4], ["table.csv", 503], ["table.tsv", 3]]) {
  await request({ action: "show", file: file(name) });
  await ready(v => v.selected?.file === file(name) && !v.source && !v.dataError && v.structuredRows === rows, name);
  if (name.endsWith("json")) {
    await request({ action: "json-toggle", path: "/items" }); await ready(v => v.structuredRows === 6, "expand JSON");
    await request({ action: "json-toggle", path: "/items" }); await ready(v => v.structuredRows === 4, "collapse JSON");
  }
  await shot("rich-" + name.replace(".", "-"));
  const saved = await fs.readFile(file(name), "utf8"), changed = saved.replace("Preview Plus", "Edited preview").replace("name", "label");
  await request({ action: "source", value: true }); await request({ action: "edit", value: changed }); await request({ action: "source", value: false });
  await ready(v => v.dirty && !v.dataError, "structured draft"); assert.equal(await fs.readFile(file(name), "utf8"), saved);
  await fs.writeFile(file(name), saved + "\n"); await request({ action: "save" });
  await ready(v => v.dirty && v.document?.saveError && !v.document.saving, "structured conflict");
  assert.equal(await fs.readFile(file(name), "utf8"), saved + "\n");
  await request({ action: "discard" }); await request({ action: "discard" }); await ready(v => !v.dirty, "structured discard");
  await request({ action: "source", value: true }); await request({ action: "edit", value: changed }); await request({ action: "save" });
  await ready(v => !v.dirty && !v.document?.saving, "structured save"); assert.equal(await fs.readFile(file(name), "utf8"), changed);
  await fs.writeFile(file(name), saved);
}
passed("Native JSON collapse and CSV/TSV virtual tables, source drafts, guarded conflicts and exact save readback");

// Direct pane.split uses file props, separately from the Files Plus routing test.
await command("layout.set", { layout: { id: "root", type: "block", content: { tab: "active" } } });
for (const name of ["data.json", "table.csv", "table.tsv"]) {
  const previousDriver = (await state())?.driverIdentity;
  const split = await command("pane.split", { direction: "right", mod: "preview-plus-driver", props: { base: control, file: file(name) } });
  assert.ok(split.pane);
  await until(state, v => v.driverIdentity && v.driverIdentity !== previousDriver && v.owner?.target?.file === file(name), "new pane driver");
  await request({ action: "activate" });
  await ready(v => v.owner?.mode === "pane" && v.selected?.file === file(name) && v.structuredRows > 0 && !v.dataError, "standalone pane " + name);
  await shot("rich-pane-" + name.replace(".", "-")); await command("pane.close", { pane: split.pane });
}
passed("Standalone JSON/CSV/TSV panes render and close cleanly");
const status = JSON.parse((await execute("herdr-app", ["status"], { env })).stdout); assert.deepEqual(status.errors, []);
await fs.writeFile(path.join(info.base, "native-rich-report.json"), JSON.stringify({ reports, errors: status.errors }, null, 2));
console.log(`report: ${info.base}/native-rich-report.json`);
