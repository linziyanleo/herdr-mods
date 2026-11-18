// Uses an already running native-session receipt; never launches an app.
// Test-only layout/fixtures are isolated and the previous layout is restored.
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { png, pdf } from "./fixtures.mjs";

if (!process.argv[2]) throw new Error("Usage: node preview-plus/tests/native-local-copy.mjs <session.json>");
const info = JSON.parse(await fs.readFile(process.argv[2], "utf8"));
const execute = promisify(execFile), env = { ...process.env, ...info.env };
const cli = async (...args) => (await execute("herdr-app", args, { env })).stdout;
const previous = JSON.parse(await cli("status")).layout;
const base = await fs.mkdtemp(path.join(info.base, "local-copy."));
const project = path.join(base, "sync"), controls = path.join(base, "control");
await fs.mkdir(project);
await fs.mkdir(controls);
const file = path.join(project, "landscape.png"), document = path.join(project, "guide.pdf");
const missing = path.join(project, "missing.png");
await fs.writeFile(file, png());
await fs.writeFile(document, pdf(2));
// A simulated remote has different bytes. No remote machine is contacted.
await fs.writeFile(path.join(base, "remote-landscape.png"), png(320, 180, true));
await fs.writeFile(path.join(base, "remote-guide.pdf"), pdf(1));
assert.notDeepEqual(await fs.readFile(file), await fs.readFile(path.join(base, "remote-landscape.png")));
assert.notDeepEqual(await fs.readFile(document), await fs.readFile(path.join(base, "remote-guide.pdf")));

const names = ["image", "pdf", "missing", "disabled"];
for (const name of names) await fs.mkdir(path.join(controls, name));
const block = (name, file, enabled = true) => ({
  id: `local-copy-${name}`, type: "block", content: {
    mod: info.previewMod || "preview-plus-driver",
    props: { base: path.join(controls, name), file, on: "demo-remote", ...(enabled ? { localSyncRoots: [project] } : {}) }
  }
});
const layout = {
  id: "root", type: "column", children: [
    { id: "copies", type: "row", size: { weight: 3 }, children: [block("image", file), block("pdf", document)] },
    { id: "errors", type: "row", size: { weight: 1 }, children: [block("missing", missing), block("disabled", file, false)] }
  ]
};
const layoutName = `preview-local-copy-${path.basename(base).replace(".", "-")}`;
const layoutFile = path.join(info.app, "layouts", `${layoutName}.json`);
await fs.writeFile(layoutFile, JSON.stringify(layout), { flag: "wx" });
async function waitState(name, accept) {
  let last;
  for (let attempt = 0; attempt < 300; attempt++) {
    try {
      last = JSON.parse(await fs.readFile(path.join(controls, name, "state.json"), "utf8"));
      if (accept(last)) return last;
    } catch (error) { if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error; }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Native ${name} did not reach expected state: ${JSON.stringify(last)}`);
}
let sequence = 0;
async function action(name, value, accept) {
  const id = `local-copy-${++sequence}`;
  await fs.writeFile(path.join(controls, name, "request.json"), JSON.stringify({ id, ...value }));
  return waitState(name, state => state.handledRequest === id && !state.loading && (!accept || accept(state)));
}

try {
  await cli("do", "layout.switch", JSON.stringify({ name: layoutName }));
  const image = await waitState("image", state => !state.loading && Boolean(state.media));
  assert.equal(image.error, null); assert.equal(image.media.localCopy, true);
  assert.equal(image.selected.on, "demo-remote"); assert.equal(image.media.width, 640);
  const firstPdf = await waitState("pdf", state => !state.loading && Boolean(state.media));
  assert.equal(firstPdf.error, null); assert.equal(firstPdf.total, 2); assert.equal(firstPdf.media.localCopy, true);
  const absent = await waitState("missing", state => !state.loading && Boolean(state.error));
  assert.equal(absent.media, null); assert.match(absent.error, /Local copy unavailable.*missing/i);
  const disabled = await waitState("disabled", state => !state.loading && Boolean(state.error));
  assert.equal(disabled.media, null); assert.match(disabled.error, /explicitly configure localSyncRoots/);

  // Production handlers, not synthetic physical input.
  await action("image", { action: "activate" });
  await action("image", { action: "zoom", value: 1.5 }, state => state.zoom === 1.5);
  await action("image", { action: "zoom", value: null }, state => state.zoom === null);
  await action("pdf", { action: "page", delta: 1 }, state => state.page === 2 && state.media?.page === 2);
  await action("pdf", { action: "zoom", value: null }, state => state.zoom === null);
  const screenshot = path.join(base, "local-copy-preview.png");
  await cli("shot", screenshot);

  await fs.writeFile(file, png(320, 180, true));
  await waitState("image", state => !state.loading && state.media?.width === 320);
  await fs.unlink(file);
  await waitState("image", state => !state.loading && /Local copy unavailable/.test(state.error));
  await fs.writeFile(file, png());
  await action("image", { action: "refresh" }, state => state.media?.width === 640 && !state.error);
  await fs.writeFile(missing, png(160, 100));
  await action("missing", { action: "refresh" }, state => state.media?.width === 160 && !state.error);
  const status = JSON.parse(await cli("status"));
  assert.deepEqual(status.errors, []);
  await fs.writeFile(path.join(base, "result.json"), JSON.stringify({
    passed: true, screenshot, checks: [
      "local image and two-page PDF with remote ownership",
      "missing local copy and default opt-out",
      "PDF page 2 and image zoom/fit production handlers",
      "local watcher modification/deletion and explicit refresh recovery",
      "missing-copy refresh recovery", "zero app errors"
    ],
    limitations: ["Simulated remote targets; no live cross-machine sync or physical input tested."]
  }, null, 2));
  console.log(JSON.stringify({ passed: true, base, screenshot }, null, 2));
} finally {
  await cli("do", "layout.switch", JSON.stringify({ name: previous }));
  await fs.unlink(layoutFile);
}
