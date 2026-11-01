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
const bundle = path.dirname(path.dirname(path.dirname(binary)));
await fs.mkdir(path.join(app, "mods"), { recursive: true });
const runtimeFile = entry => !["jsconfig.json", "gpui-kit.d.ts", "herdr.d.ts"].includes(path.basename(entry));
await fs.cp(fileURLToPath(new URL("../mods/files-plus", import.meta.url)), path.join(app, "mods/files-plus"), { recursive: true, filter: runtimeFile });
const driver = path.join(app, "mods/files-plus-driver");
await fs.cp(path.join(app, "mods/files-plus"), driver, { recursive: true });
await fs.rename(path.join(driver, "main.js"), path.join(driver, "panel.js"));
await fs.copyFile(fileURLToPath(new URL("native-driver.js", import.meta.url)), path.join(driver, "main.js"));
await fs.writeFile(path.join(driver, "mod.json"), '{"place":"none"}');
await fs.mkdir(path.join(app, "layouts"));
await fs.writeFile(path.join(app, "settings.json"), JSON.stringify({ telemetry: false, sounds: { enabled: false }, appearance: "dark", core: (await execute("which", ["hc"])).stdout.trim() }));
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
