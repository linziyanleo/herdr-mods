// Native acceptance for calibrated menus and panel fitting. Mouse drags are checked separately.
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile), info = JSON.parse(await fs.readFile(process.argv[2], "utf8"));
assert.ok(info.base.startsWith("/tmp/fp."));
const env = { ...process.env, ...info.env }, base = info.base, web = path.join(base, "width", "web"), api = path.join(base, "width", "api");
assert.equal(path.resolve(info.app), path.resolve(base, "app"), "Native verification requires a disposable Herdr home");
assert.equal(path.resolve(info.env.HERDR_APP_HOME), path.resolve(info.app));
const driverMod = info.driverMod || "files-plus-driver";
await fs.mkdir(web, { recursive: true }); await fs.mkdir(api, { recursive: true });
const workspace = path.join(base, "fit.herdr-workspace.json");
await fs.writeFile(workspace, JSON.stringify({ name: "Width fixture", folders: [{ path: web, name: "W" }, { path: api, name: "A" }] }));
const command = async (name, args = {}) => JSON.parse((await execute("herdr-app", ["do", name, JSON.stringify(args)], { env })).stdout);
const panel = () => fs.readFile(path.join(base, "native-state-panel-fit.json"), "utf8").then(JSON.parse);
async function until(read, accept, description) {
  let value;
  for (let n = 0; n < 120; n++) {
    try { value = await read(); if (accept(value)) return value; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`${description}: ${JSON.stringify(value).slice(0, 1500)}`);
}
async function request(value) {
  await fs.rm(path.join(base, "receipt.json"), { force: true });
  await fs.writeFile(path.join(base, "request.json"), JSON.stringify(value));
  await command(`${driverMod}.test`);
  const reply = await until(() => fs.readFile(path.join(base, "receipt.json"), "utf8").then(JSON.parse), () => true, "request receipt");
  assert.equal(reply.error, undefined); return reply;
}
const shots = [], checks = [];
const width = value => Math.round(value.panelSize.width / (value.zoom || 1));
async function shot(name) { const file = path.join(base, `${name}.png`); await execute("herdr-app", ["shot", file], { env }); shots.push(file); }
async function close() { for (const overlay of JSON.parse((await execute("herdr-app", ["status"], { env })).stdout).overlays) await command("overlay.close"); }
const settingsPath = path.join(info.app, "settings.json"), originalSettingsText = await fs.readFile(settingsPath, "utf8"), originalSettings = JSON.parse(originalSettingsText);
const originalZoom = JSON.parse((await execute("herdr-app", ["status"], { env })).stdout).zoom;
async function setZoom(target) {
  await command("app.zoom_reset");
  for (let n = 0; n < Math.round(Math.abs(target - 1) * 10); n++) await command(target > 1 ? "app.zoom_in" : "app.zoom_out");
}
const layout = { id: "root", type: "column", children: [{ id: "tabs", type: "block", size: { px: 38 }, content: { mod: "tabs" } }, { id: "body", type: "row", children: [
  { id: "terminal", type: "block", content: { tab: "active" } },
  { id: "panel", type: "column", min: 280, max: 900, size: { px: 420 }, children: [{ id: "files", type: "block", content: { mod: driverMod, props: { base, owner: !info.driverMod, driverMod, fit: { node: "panel", min: 280, max: 0.38 } } } }] }
] }] };
assert.equal((await request({ type: "activate" })).windowActive, true, "Bring the disposable Herdr window to the foreground before native UI acceptance");
if (!info.driverMod) await command("window.maximize");
await close();
await fs.writeFile(path.join(info.app, "layouts/files-plus-fit.json"), JSON.stringify(layout));
await command("layout.switch", { name: "files-plus-fit" });
await request({ type: "workspace", file: null });
await request({ type: "workspace", file: workspace });
await new Promise(resolve => setTimeout(resolve, 400));
const initial = await until(panel, value => value.visible && value.panelSize && (!value.lastRequestedWidth || Math.abs(width(value) - value.lastRequestedWidth) <= 4), "initial fitted width");
assert.ok(initial.metrics.unit13 > 0 && initial.metrics.samples13?.length === 2);
assert.ok(width(initial) >= 280 && width(initial) <= Math.floor(initial.viewport.width / (initial.zoom || 1) * 0.38));
checks.push({ name: "calibrated panel fitting", width: width(initial), metrics: initial.metrics });

const folder = path.join(web, "width-fixture"); await fs.mkdir(folder, { recursive: true });
const wideName = "中文文件".repeat(14) + ".txt", longFile = path.join(folder, wideName);
await fs.writeFile(longFile, "Wide filename fixture\n");
await request({ type: "toggle", path: folder });
const expanded = await until(panel, value => value.folders.includes(folder) && value.entries[folder]?.some(entry => entry.name === wideName), "expanded folder loads");
await new Promise(resolve => setTimeout(resolve, 600));
assert.equal(width(await panel()), width(initial));
await request({ type: "toggle", path: folder });
const collapsed = await until(panel, value => !value.folders.includes(folder), "folder collapses");
await new Promise(resolve => setTimeout(resolve, 600));
assert.equal(width(await panel()), width(initial));
checks.push({ name: "expansion and collapse keep panel width", initial: width(initial), expanded: width(expanded), collapsed: width(collapsed) });

const backgroundFile = path.join(web, wideName); await fs.writeFile(backgroundFile, "Background width fixture\n");
const grown = await until(panel, value => value.entries[web]?.some(entry => entry.name === wideName), "background entry appears");
await new Promise(resolve => setTimeout(resolve, 500));
assert.equal(width(await panel()), width(initial));
await fs.unlink(backgroundFile);
await until(panel, value => !value.entries[web]?.some(entry => entry.name === wideName), "background deletion appears");
await new Promise(resolve => setTimeout(resolve, 500));
assert.equal(width(await panel()), width(grown));
checks.push({ name: "workspace descendants keep panel width on background updates", width: width(grown) });

const manualWidth = width(grown) > 420 ? 420 : 560;
await command("layout.resize", { id: "panel", px: manualWidth });
const manual = await until(panel, value => Boolean(value.manualWidthSpace), "manual resize pauses fitting");
await request({ type: "toggle", path: folder }); await new Promise(resolve => setTimeout(resolve, 600));
assert.ok(Math.abs((await panel()).panelSize.width / (manual.zoom || 1) - manualWidth) <= 4);
await request({ type: "workspace", file: null });
await until(panel, value => !value.manualWidthSpace && value.location.entry === null, "context switch resets manual override");
await request({ type: "workspace", file: workspace });
checks.push({ name: "manual override and context reset", width: manualWidth });

const source = path.join(web, "source-fixture.txt"); await fs.writeFile(source, "const ready = true;\n");
await request({ type: "preview", path: source, root: web });
await until(panel, value => value.file === source && value.preview, "source preview"); await shot("source-preview-selected");
await request({ type: "back" });
assert.equal((await until(panel, value => value.file === null, "Back to tree")).selectedFile, source);
checks.push({ name: "selection retained after preview Back" });
await fs.writeFile(path.join(base, "followup-report.json"), JSON.stringify({ checks, screenshots: shots, stage: "sizing passed; theme/zoom checks pending" }, null, 2));
console.log("passed: calibration, stable folder width, manual override, context reset and preview selection");

try {
for (const appearance of ["dark", "light"]) for (const scale of [1, 1.2]) {
  await fs.writeFile(settingsPath, JSON.stringify({ ...JSON.parse(await fs.readFile(settingsPath, "utf8")), appearance }));
  await command("app.theme", { name: appearance === "dark" ? "graphite" : "paper" });
  await setZoom(scale);
  const state = await until(panel, value => value.dark === (appearance === "dark") && Math.abs(value.zoom - scale) < 0.001 && value.metrics.samples13?.length === 2, "theme and zoom calibration");
  const view = state.viewport;
  for (const kind of ["file", "root"]) {
    const reply = await request({ type: "menu", path: kind === "root" ? web : source, root: web, kind, pointer: { x: view.width - 2, y: view.height - 2 } });
    const menu = await until(() => fs.readFile(path.join(base, `native-state-${reply.overlay}.json`), "utf8").then(JSON.parse), value => value.role === "menu" && value.entered, "menu layout");
    assert.ok(menu.geometry.at.x + menu.geometry.width * scale <= view.width - 8 * scale + 0.1);
    assert.ok(menu.geometry.at.y + menu.geometry.height * scale <= view.height - 8 * scale + 0.1);
    await shot(`menu-${kind}-${appearance}-${scale}`); await close();
    checks.push({ name: `${kind} menu ${appearance} at ${scale}`, geometry: menu.geometry });
  }
  await request({ type: "dialog", action: "rename", path: source, root: web }); await shot(`dialog-${appearance}-${scale}`); await close();
}
} finally {
  await command("app.theme", { name: originalSettings.appearance === "light" ? "paper" : "graphite" });
  await setZoom(originalZoom);
  const restored = JSON.parse(await fs.readFile(settingsPath, "utf8"));
  for (const key of ["appearance", "zoom"]) {
    if (Object.hasOwn(originalSettings, key)) restored[key] = originalSettings[key]; else delete restored[key];
  }
  await fs.writeFile(settingsPath, JSON.stringify(restored) === JSON.stringify(originalSettings) ? originalSettingsText : JSON.stringify(restored));
}
const status = JSON.parse((await execute("herdr-app", ["status"], { env })).stdout); assert.deepEqual(status.errors, []);
await fs.writeFile(path.join(base, "followup-report.json"), JSON.stringify({ checks, screenshots: shots, errors: status.errors, drag: "Continuous mouse drag is a separate native check" }, null, 2));
console.log(JSON.stringify({ passed: checks.length, report: `${base}/followup-report.json` }));
