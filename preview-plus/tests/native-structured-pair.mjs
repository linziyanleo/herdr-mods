// Reuse an isolated Preview Plus session to verify real Files Plus handoffs.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
const info = JSON.parse(await fs.readFile(process.argv[2], "utf8"));
assert.ok(info.base.startsWith("/tmp/pp."));
assert.equal(info.app, path.join(info.base, "app"));
assert.equal(info.env.HERDR_APP_HOME, info.app);
const env = { ...process.env, ...info.env }, root = await fs.realpath(info.project);
const previewControl = path.join(info.base, "control"), filesControl = path.join(info.base, "files");
const read = async file => JSON.parse(await fs.readFile(file, "utf8"));
const preview = () => read(path.join(previewControl, "state.json"));
const files = () => read(path.join(filesControl, "native-state-panel.json"));
const command = async (name, args = {}) => JSON.parse((await execute("herdr-app", ["do", name, JSON.stringify(args)], { env })).stdout);
async function until(readValue, accept, label) {
  for (let n = 0; n < 160; n++) {
    let value;
    try { value = await readValue(); } catch {}
    if (value !== undefined && accept(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${label}`);
}
async function filesRequest(value) {
  await fs.rm(path.join(filesControl, "receipt.json"), { force: true });
  await fs.writeFile(path.join(filesControl, "request.json"), JSON.stringify(value));
  await command("files-plus-driver.test");
  const result = await until(() => read(path.join(filesControl, "receipt.json")), () => true, "Files Plus request");
  assert.equal(result.error, undefined);
}
async function back() {
  const id = `${Date.now()}-${Math.random()}`;
  await fs.writeFile(path.join(previewControl, "request.json"), JSON.stringify({ id, action: "back" }));
  const result = await until(() => read(path.join(previewControl, "receipt.json")), value => value.id === id, "Preview Plus back");
  assert.equal(result.error, undefined);
}

const samples = [
  ["sample.json", '{"project":"Herdr","ready":true,"files":["README.md","sample.csv"]}\n'],
  ["sample.csv", 'name,status,notes\nFiles Plus,ready,"Search, then preview"\nPreview Plus,ready,"A quoted\nmultiline cell"\n'],
  ["sample.tsv", "name\tcount\nFiles Plus\t3\nPreview Plus\t5\n"],
];
await fs.mkdir(path.join(root, "structured"), { recursive: true });
for (const [name, text] of samples) await fs.writeFile(path.join(root, "structured", name), text);
await fs.rm(path.join(previewControl, "request.json"), { force: true });
await command("layout.set", { layout: { id: "root", type: "row", children: [
  { id: "files", type: "stack", active: "files-plus-tree", children: [
    { id: "files-plus-tree", type: "block", content: { mod: "files-plus-driver", props: { base: filesControl, previewStack: "files" } } },
    { id: "preview-plus", type: "block", content: { mod: "preview-plus-driver", props: { base: previewControl, previewStack: "files" } } },
  ] },
] } });
await until(files, value => Boolean(value.entries?.[root]), "Files Plus tree");
await filesRequest({ type: "open-location", value: "internal" });
if (!(await files()).folders.includes(path.join(root, "structured"))) {
  await filesRequest({ type: "toggle", path: path.join(root, "structured") });
}
const reports = [];
for (const [name, text] of samples) {
  const file = path.join(root, "structured", name);
  await filesRequest({ type: "preview", path: file, root });
  // Hidden test windows may not paint a changed stack until resized.
  await command("window.maximize");
  const value = await until(preview, value => value.selected?.file === file && !value.loading && !value.error && !value.dataError && value.structuredRows > 0, name);
  assert.equal(value.selected.root, root);
  assert.equal(value.selected.on, null);
  assert.equal(value.owner.mode, "paired");
  assert.equal(value.source, false);
  assert.equal(value.text, text);
  assert.deepEqual(value.history, []);
  await command("window.maximize");
  await execute("herdr-app", ["shot", path.join(info.base, `paired-${name.split(".").pop()}.png`)], { env });
  await back();
  await filesRequest({ type: "snapshot" });
  assert.ok((await files()).folders.includes(path.join(root, "structured")));
  reports.push(`${name}: real paired preview, target identity, back and retained tree`);
  console.log(`passed: ${reports.at(-1)}`);
}
const status = JSON.parse((await execute("herdr-app", ["status"], { env })).stdout);
assert.deepEqual(status.errors, []);
await fs.writeFile(path.join(info.base, "native-structured-pair-report.json"), JSON.stringify({ reports, errors: status.errors }, null, 2));
