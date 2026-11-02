// Launch only a disposable app home and core, using the installed, unchanged Herdr binary.
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execute = promisify(execFile);
if (process.platform !== "darwin") throw new Error("This native window fixture currently supports macOS");
// Keep the core's Unix socket below macOS's 103-byte path limit.
const base = await fs.mkdtemp("/tmp/fp.");
const app = path.join(base, "app"), project = path.join(base, "project");
const env = { ...process.env, HERDR_APP_HOME: app, XDG_STATE_HOME: path.join(base, "s"), XDG_CONFIG_HOME: path.join(base, "c"), HC_SESSION: "fp", HERDR_TELEMETRY: "0" };
const cli = (await execute("which", ["herdr-app"])).stdout.trim();
const binary = await fs.realpath(cli);
const installedBundle = path.dirname(path.dirname(path.dirname(binary)));
const bundle = process.argv.includes("--distinct-bundle") ? path.join(base, "Herdr.app") : installedBundle;
if (bundle !== installedBundle) await fs.cp(installedBundle, bundle, { recursive: true });
await fs.mkdir(path.join(app, "mods"), { recursive: true });
const runtimeFile = entry => !["jsconfig.json", "gpui-kit.d.ts", "herdr.d.ts"].includes(path.basename(entry));
await fs.cp(process.env.FILES_PLUS_RUNTIME || fileURLToPath(new URL("../mods/files-plus", import.meta.url)), path.join(app, "mods/files-plus"), { recursive: true, filter: runtimeFile });
await fs.writeFile(path.join(app, "mods/files-plus/mod.json"), '{"place":"none"}');
const driver = path.join(app, "mods/files-plus-driver");
await fs.cp(path.join(app, "mods/files-plus"), driver, { recursive: true });
await fs.rename(path.join(driver, "main.js"), path.join(driver, "panel.js"));
await fs.copyFile(fileURLToPath(new URL(process.argv.includes("--performance") ? "native-performance-driver.js" : "native-driver.js", import.meta.url)), path.join(driver, "main.js"));
await fs.writeFile(path.join(driver, "mod.json"), '{"place":"none"}');
if (!process.argv.includes("--performance")) {
  const canonical = path.join(app, "mods/files-plus");
  await fs.rename(path.join(canonical, "main.js"), path.join(canonical, "panel.js"));
  await fs.copyFile(fileURLToPath(new URL("native-driver.js", import.meta.url)), path.join(canonical, "main.js"));
}
if (process.argv.includes("--performance")) {
  const file = path.join(driver, "workspace.js");
  let code = (await fs.readFile(file, "utf8")).replace(/\bexec,/, "exec as rawExec,");
  code += '\nfunction exec(command, ...args) { const s = globalThis.__fpStats ||= { exec: 0, rows: 0, programs: {} }; s.exec++; s.programs[command] = (s.programs[command] || 0) + 1; return rawExec(command, ...args); }\n';
  if (code.includes("out.push(h_flex()")) code = code.replace("out.push(h_flex()", "globalThis.__fpStats.rows++; out.push(h_flex()").replace("roots.map(folder => {", "roots.map(folder => { globalThis.__fpStats.rows++;");
  await fs.writeFile(file, code);
  const roots = path.join(driver, "roots.js");
  const rootCode = (await fs.readFile(roots, "utf8")).replace(/\bexec,/, "exec as rawExec,");
  await fs.writeFile(roots, rootCode + '\nfunction exec(command, ...args) { const s = globalThis.__fpStats ||= { exec: 0, rows: 0, programs: {} }; s.exec++; s.programs[command] = (s.programs[command] || 0) + 1; return rawExec(command, ...args); }\n');
  const tree = path.join(driver, "tree.js");
  try {
    const code = await fs.readFile(tree, "utf8");
    await fs.writeFile(tree, code.replace("const { rows, panel, look } = this.data;", "const { rows, panel, look } = this.data; const stats = globalThis.__fpStats ||= { exec: 0, rows: 0, programs: {} }; stats.rows += rows.filter(row => row.path).length;"));
  } catch (error) { if (error.code !== "ENOENT") throw error; }
}
await fs.mkdir(path.join(app, "layouts"));
await fs.writeFile(path.join(app, "settings.json"), JSON.stringify({ telemetry: false, sounds: { enabled: false }, appearance: "dark", core: (await execute("which", ["hc"])).stdout.trim() }));
await fs.writeFile(path.join(app, "shared.json"), JSON.stringify({ "frame.welcomed": "skipped" }));
const layout = { id: "root", type: "column", children: [
  { id: "tabs", type: "block", size: { px: 38 }, content: { mod: "tabs" } },
  { id: "body", type: "row", children: [
    { id: "terminal", type: "block", size: { weight: 1 }, content: { tab: "active" } },
    { id: "files", type: "block", size: { px: 420 }, content: { mod: "files-plus-driver", props: { base } } }
  ] }
] };
await fs.writeFile(path.join(app, "layouts/files-plus-test.json"), JSON.stringify(layout, null, 2));
for (const name of ["web", "api"]) {
  const root = path.join(project, name);
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.mkdir(path.join(root, "docs"));
  await fs.writeFile(path.join(root, "README.md"), `# ${name === "web" ? "Web" : "API"}\n\nFiles Plus disposable workspace.\n`);
  await fs.writeFile(path.join(root, "src", name === "web" ? "app.ts" : "server.ts"), "export const ready = true;\n");
  await fs.writeFile(path.join(root, "docs/notes with spaces.md"), "# Notes\n\nA file name with spaces.\n");
  await fs.writeFile(path.join(root, "package.json"), '{ "name": "files-plus-demo", "private": true }\n');
  await execute("git", ["init", "-q", root]);
}
const workspace = path.join(project, "Product.herdr-workspace.json");
await fs.writeFile(workspace, JSON.stringify({ name: "Product", folders: [{ path: "web", name: "Web", keep: true }, { path: "api", name: "API" }], custom: "preserved" }, null, 2) + "\n");
// LaunchServices preserves the installed bundle's signature. A copied binary
// with a different Info.plist is rejected by macOS before it can draw a window.
const overrides = ["HERDR_APP_HOME", "XDG_STATE_HOME", "XDG_CONFIG_HOME", "HC_SESSION", "HERDR_TELEMETRY"];
await execute("/usr/bin/open", ["-n", "-a", bundle, ...overrides.flatMap(key => ["--env", `${key}=${env[key]}`]), "--stdout", path.join(base, "app.log"), "--stderr", path.join(base, "app.log")]);
let available = false;
for (let attempt = 0; attempt < 100; attempt++) {
  try { await execute(cli, ["status"], { env }); available = true; break; }
  catch { await new Promise(resolve => setTimeout(resolve, 100)); }
}
if (!available) throw new Error(`Isolated Herdr did not start. See ${base}/app.log`);
const first = JSON.parse((await execute(cli, ["do", "space.new", JSON.stringify({ name: "Product", folder: path.join(project, "web"), argv: ["/bin/zsh", "-f"] })], { env })).stdout);
const second = JSON.parse((await execute(cli, ["do", "tab.new", JSON.stringify({ name: "API", space: first.space, folder: path.join(project, "api"), argv: ["/bin/zsh", "-f"] })], { env })).stdout);
await execute(cli, ["do", "layout.switch", JSON.stringify({ name: "files-plus-test" })], { env });
await execute(cli, ["do", "overlay.close", JSON.stringify({ id: "frame-welcome" })], { env });
const info = { base, app, bundle, env: Object.fromEntries(overrides.map(key => [key, env[key]])), workspace, first, second };
await fs.writeFile(path.join(base, "session.json"), JSON.stringify(info, null, 2));
console.log(JSON.stringify(info, null, 2));
