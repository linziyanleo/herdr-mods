import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { png, pdf } from "./fixtures.mjs";

const execute = promisify(execFile), info = JSON.parse(await fs.readFile(process.argv[2], "utf8"));
assert.ok(info.base.startsWith("/tmp/pp."));
const env = { ...process.env, ...info.env }, control = path.join(info.base, "control"), reports = [];
const command = async (name, args = {}) => JSON.parse((await execute("herdr-app", ["do", name, JSON.stringify(args)], { env })).stdout);
const state = async () => JSON.parse(await fs.readFile(path.join(control, "state.json"), "utf8"));
async function until(read, accept, label) {
  for (let n = 0; n < 160; n++) {
    let value;
    try { value = await read(); } catch {}
    if (value !== undefined && accept(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Timed out: " + label + "\n" + JSON.stringify(await state()));
}
async function request(value) {
  const id = `${Date.now()}-${Math.random()}`;
  await fs.writeFile(path.join(control, "request.json"), JSON.stringify({ ...value, id }));
  const receipt = await until(async () => JSON.parse(await fs.readFile(path.join(control, "receipt.json"), "utf8")), value => value.id === id, "request " + value.action);
  assert.equal(receipt.error, undefined);
}
async function ready(file, accept = () => true) {
  return until(state, value => value.selected?.file === file && !value.loading && !value.error && accept(value), "ready " + file);
}
function passed(name) { reports.push(name); console.log("passed: " + name); }
const file = name => path.join(info.project, name), root = await fs.realpath(info.project);

await fs.rm(path.join(control, "request.json"), { force: true });
await command("layout.set", { layout: { id: "root", type: "block", content: { mod: "preview-plus-driver", props: { base: control } } } });
await until(state, value => value.owner?.mode === "files" && !value.tree?.loading && value.tree?.entries[""]?.length > 0, "standalone tree");
await request({ action: "toggle", path: "notes" });
await until(state, value => value.tree?.entries.notes?.length > 0, "expanded tree");
await request({ action: "show", file: file("README.md"), root });
let current = await ready(file("README.md"), value => value.markdownBlocks?.some(block => block.media?.path.startsWith("mods/preview-plus/.cache/")));
assert.equal(current.imageWarning, false);
await execute("herdr-app", ["shot", path.join(info.base, "markdown.png")], { env });
await request({ action: "source", value: true }); await until(state, value => value.source, "source view");
await execute("herdr-app", ["shot", path.join(info.base, "source.png")], { env });
await request({ action: "follow", href: "notes/next.markdown" });
await ready(file("notes/next.markdown"), value => value.history.length === 1);
await request({ action: "back" }); await ready(file("README.md"), value => value.source);
await request({ action: "follow", href: "landscape.png" }); await ready(file("landscape.png"), value => value.media?.width === 640);
await request({ action: "zoom", value: 1 }); await until(state, value => value.zoom === 1, "100 percent");
await execute("herdr-app", ["shot", path.join(info.base, "image-actual.png")], { env });
await request({ action: "zoom", value: 2 }); await until(state, value => value.zoom === 2, "zoom in");
await request({ action: "zoom", value: null }); await until(state, value => value.zoom === null, "fit");
current = await state(); const firstImage = current.media.path;
await fs.writeFile(file("landscape.png"), png(640, 400, true));
await ready(file("landscape.png"), value => value.media?.path !== firstImage);
await request({ action: "back" }); await ready(file("README.md"));
await request({ action: "back" }); await until(state, value => value.selected === null && value.tree?.folders.includes("notes"), "tree back");
passed("Standalone Files: Markdown/source, linked note/image history, retained tree expansion, fit/zoom and native image-update watcher");

await request({ action: "show", file: file("diagram.svg"), root }); await ready(file("diagram.svg"), value => value.media?.width === 640 && value.media.height === 240);
await execute("herdr-app", ["shot", path.join(info.base, "svg.png")], { env });
await request({ action: "show", file: file("guide.pdf"), root }); await ready(file("guide.pdf"), value => value.page === 1 && value.total === 2);
await execute("herdr-app", ["shot", path.join(info.base, "pdf-one.png")], { env });
await request({ action: "page", delta: 1 }); current = await ready(file("guide.pdf"), value => value.page === 2 && value.media?.page === 2);
assert.ok(current.media.width > current.media.height);
await execute("herdr-app", ["shot", path.join(info.base, "pdf-two.png")], { env });
const oldPDF = current.media.path;
await fs.writeFile(file("guide.pdf"), pdf().replace("Page Two", "Page New"));
await ready(file("guide.pdf"), value => value.page === 2 && value.media?.path !== oldPDF);
await request({ action: "page", delta: -1 }); await ready(file("guide.pdf"), value => value.page === 1);
await request({ action: "page", delta: 1 }); await ready(file("guide.pdf"), value => value.page === 2);
await fs.writeFile(file("guide.pdf"), pdf(1)); await ready(file("guide.pdf"), value => value.page === 1 && value.total === 1);
await fs.writeFile(file("guide.pdf"), pdf()); await ready(file("guide.pdf"), value => value.total === 2);
passed("Native SVG and two-page PDF rendering, Previous/Next, orientation, PDF-update watcher and clamping after page removal");

await request({ action: "show", file: file("source.txt"), root }); await ready(file("source.txt"), value => value.text.includes("read-only"));
await fs.writeFile(file("source.txt"), "Changed in an external editor.\n"); await ready(file("source.txt"), value => value.text.includes("external editor"));
await fs.rm(file("source.txt")); await until(state, value => !value.loading && /no longer available/.test(value.error), "deleted text");
await fs.writeFile(file("source.txt"), "A read-only text file.\n"); await ready(file("source.txt"));
await request({ action: "show", file: "/remote/photo.png", root: "/remote", on: "server" });
await until(state, value => !value.loading && /only available for local/.test(value.error), "remote media note");
passed("Native text update, deletion, recovery and explicit remote-media state");

const pairedLayout = { id: "root", type: "row", children: [
  { id: "files", type: "stack", active: "files-plus-tree", children: [
    { id: "files-plus-tree", type: "block", content: { mod: "files-plus-driver", props: { base: path.join(info.base, "files"), previewStack: "files" } } },
    { id: "preview-plus", type: "block", content: { mod: "preview-plus-driver", props: { base: control, previewStack: "files" } } }
  ] }
] };
await fs.rm(path.join(control, "request.json"), { force: true });
await command("layout.set", { layout: pairedLayout });
async function filesRequest(value) {
  await fs.rm(path.join(info.base, "files/receipt.json"), { force: true });
  await fs.writeFile(path.join(info.base, "files/request.json"), JSON.stringify(value));
  await command("files-plus-driver.test");
  const receipt = await until(async () => JSON.parse(await fs.readFile(path.join(info.base, "files/receipt.json"), "utf8")), () => true, "Files Plus request"); assert.equal(receipt.error, undefined);
}
await until(async () => JSON.parse(await fs.readFile(path.join(info.base, "files/native-state-panel.json"), "utf8")), value => Boolean(value.entries[root]), "Files Plus tree");
await filesRequest({ type: "toggle", path: `${root}/notes` });
for (const name of ["README.md", "diagram.svg", "guide.pdf"]) {
  const selected = `${root}/${name}`;
  await filesRequest({ type: "preview", path: selected, root });
  await ready(selected, value => value.owner.mode === "paired");
  if (name === "README.md") {
    await request({ action: "follow", href: "notes/next.markdown" }); await ready(`${root}/notes/next.markdown`);
    await request({ action: "back" }); await ready(selected);
  }
  await request({ action: "back" });
  await filesRequest({ type: "snapshot" });
  const source = JSON.parse(await fs.readFile(path.join(info.base, "files/native-state-panel.json"), "utf8"));
  assert.ok(source.folders.includes(`${root}/notes`));
}
passed("Real Files Plus shared-target handoff for Markdown/SVG/PDF, linked history, root back and retained expansion");

const split = await command("pane.split", { direction: "right", mod: "preview-plus", props: { file: file("guide.pdf") } });
assert.ok(split.pane);
await command("layout.set", { layout: { id: "root", type: "block", content: { tab: "active" } } });
await execute("herdr-app", ["shot", path.join(info.base, "standalone-pane.png")], { env });
await command("pane.close", { pane: split.pane });
passed("Standalone pane.split file props and clean pane close");

const status = JSON.parse((await execute("herdr-app", ["status"], { env })).stdout); assert.deepEqual(status.errors, []);
await fs.writeFile(path.join(info.base, "native-report.json"), JSON.stringify({ version: (await execute("herdr-app", ["--version"])).stdout.trim(), platform: process.platform, reports, errors: status.errors }, null, 2));
console.log(`report: ${info.base}/native-report.json`);
