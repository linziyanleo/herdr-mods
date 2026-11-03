// Uses the native-session fixture, real EditorState and guarded filesystem writes.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile), info = JSON.parse(await fs.readFile(process.argv[2], "utf8"));
assert.ok(info.base.startsWith("/tmp/pp."));
const env = { ...process.env, ...info.env }, control = path.join(info.base, "control"), reports = [];
const state = async () => JSON.parse(await fs.readFile(path.join(control, "state.json"), "utf8"));
async function until(read, accept, label) {
  for (let n = 0; n < 150; n++) {
    let result;
    try { result = await read(); } catch {}
    if (result && accept(result)) return result;
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
const ready = (accept, label) => until(state, value => !value.loading && !value.error && accept(value), label);
const passed = label => { reports.push(label); console.log("passed: " + label); };
const command = async (name, args = {}) => execute("herdr-app", ["do", name, JSON.stringify(args)], { env });
const shot = async name => { await request({ action: "activate" }); await execute("herdr-app", ["shot", path.join(info.base, name + ".png")], { env }); };
await request({ action: "activate" });
await fs.rm(path.join(control, "request.json"), { force: true });
await command("layout.set", { layout: { id: "root", type: "block", content: { mod: "preview-plus-driver", props: { base: control } } } });
await ready(value => value.owner?.mode === "files", "standalone mode");
const file = path.join(info.project, `editor-${Date.now()}.md`), other = path.join(info.project, "editor-other.txt");
const original = "# Native editor\n\nOriginal text.\n";
const edited = "# Native editor\n\n中文编辑与保存。 " + "This is one long line that wraps visually without changing the file. ".repeat(16) + "\n";
await fs.writeFile(file, original); await fs.writeFile(other, "Other file\n");
await request({ action: "show", file }); await ready(v => v.selected?.file === file && v.codeText === original, "open local file");
await request({ action: "source", value: true });
await request({ action: "edit", value: edited });
await ready(v => v.dirty && v.text === edited, "edit handler");
if (!(await state()).wrap) await request({ action: "wrap" });
await ready(v => v.wrap && v.codeText === edited, "wrap on");
await shot("editor-wrap");
await request({ action: "wrap" }); await ready(v => !v.wrap && v.codeText === edited, "wrap off");
await shot("editor-nowrap");
await request({ action: "source", value: false });
await ready(v => v.markdownBlocks?.some(b => b.text?.includes("中文编辑")), "draft Markdown preview");
await shot("editor-preview");
assert.equal(await fs.readFile(file, "utf8"), original);
passed("Native EditorState with the production change handler, Unicode drafts, wrap toggle and Markdown preview without writing the file");

await request({ action: "show", file: other }); await ready(v => v.selected?.file === other && v.codeText === "Other file\n", "other file");
await request({ action: "show", file }); await ready(v => v.codeText === edited && v.dirty, "recover draft");
await request({ action: "key", value: "cmd-s" });
await ready(v => !v.dirty && !v.document?.saving, "save");
assert.equal(await fs.readFile(file, "utf8"), edited);
passed("Navigation restores the draft; save handler writes exact Unicode text through native writeTextFile");

const draft = edited + "\nMy unsaved changes.\n", external = "# Changed outside Preview Plus\n";
await request({ action: "edit", value: draft }); await ready(v => v.dirty && v.text === draft, "second draft");
await fs.writeFile(file, external);
await ready(v => v.document?.external && v.codeText === draft, "watcher preserves draft");
await request({ action: "save" }); await ready(v => v.document?.saveError && !v.document.saving, "guarded save failure");
assert.equal(await fs.readFile(file, "utf8"), external);
await shot("editor-conflict");
await request({ action: "discard" }); await ready(v => v.dirty, "discard confirmation");
await request({ action: "discard" }); await ready(v => !v.dirty && v.codeText === external, "discard and reload");
passed("Native watcher and stale-snapshot rejection protect external edits; confirmed discard reloads disk");

await request({ action: "edit", value: draft }); await ready(v => v.dirty, "recovery draft");
await command("layout.set", { layout: { id: "root", type: "block", content: { mod: "preview-plus-driver", props: { base: control, file } } } });
await ready(v => v.owner?.mode === "pane" && v.codeText === draft && v.dirty, "draft recovery after remount");
await request({ action: "source", value: true });
if (!(await state()).wrap) await request({ action: "wrap" });
await ready(v => v.wrap, "final wrapped editor");
await shot("editor-final");
passed("Persistent draft recovery after replacing the mod instance");
const status = JSON.parse((await execute("herdr-app", ["status"], { env })).stdout);
assert.deepEqual(status.errors, []);
await fs.writeFile(path.join(info.base, "native-editor-report.json"), JSON.stringify({ version: (await execute("herdr-app", ["--version"])).stdout.trim(), reports, errors: status.errors }, null, 2));
console.log(JSON.stringify({ base: info.base, reports, errors: status.errors }, null, 2));
