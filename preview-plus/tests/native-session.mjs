// Uses a disposable app home and core; the user's app, layouts and keys stay untouched.
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { fixtures } from "./fixtures.mjs";

if (process.platform !== "darwin") throw new Error("Native window acceptance currently requires macOS.");
const execute = promisify(execFile), base = await fs.mkdtemp("/tmp/pp."), app = path.join(base, "app"), project = path.join(base, "project");
const env = { ...process.env, HERDR_APP_HOME: app, XDG_STATE_HOME: path.join(base, "s"), XDG_CONFIG_HOME: path.join(base, "c"), HC_SESSION: "pp", HERDR_TELEMETRY: "0" };
const cli = (await execute("which", ["herdr-app"])).stdout.trim(), binary = await fs.realpath(cli), bundle = path.dirname(path.dirname(path.dirname(binary)));
const runtime = fileURLToPath(new URL("../mods/preview-plus", import.meta.url));
await fs.mkdir(path.join(app, "mods"), { recursive: true });
const filter = file => !["jsconfig.json", "gpui-kit.d.ts", "herdr.d.ts", ".cache"].includes(path.basename(file));
await fs.cp(runtime, path.join(app, "mods/preview-plus"), { recursive: true, filter });
const driver = path.join(app, "mods/preview-plus-driver"); await fs.cp(runtime, driver, { recursive: true, filter });
await fs.rename(path.join(driver, "main.js"), path.join(driver, "panel.js"));
await fs.copyFile(fileURLToPath(new URL("native-driver.js", import.meta.url)), path.join(driver, "main.js"));
const files = fileURLToPath(new URL("../../files-plus/mods/files-plus", import.meta.url));
await fs.cp(files, path.join(app, "mods/files-plus"), { recursive: true, filter });
await fs.writeFile(path.join(app, "mods/files-plus/mod.json"), '{"place":"none"}');
const filesDriver = path.join(app, "mods/files-plus-driver"); await fs.cp(files, filesDriver, { recursive: true, filter });
await fs.rename(path.join(filesDriver, "main.js"), path.join(filesDriver, "panel.js"));
await fs.copyFile(fileURLToPath(new URL("../../files-plus/tests/native-driver.js", import.meta.url)), path.join(filesDriver, "main.js"));
await fs.writeFile(path.join(filesDriver, "mod.json"), '{"place":"none"}');
for (const dir of ["control", "files", "project", "app/layouts"]) await fs.mkdir(path.join(base, dir), { recursive: true });
await fixtures(project);
await fs.writeFile(path.join(app, "settings.json"), JSON.stringify({ telemetry: false, sounds: { enabled: false }, appearance: "dark", core: (await execute("which", ["hc"])).stdout.trim() }));
await fs.writeFile(path.join(app, "shared.json"), JSON.stringify({ "frame.welcomed": "skipped", "workspace.panels": [] }));
const layout = { id: "root", type: "row", children: [
  { id: "preview", type: "block", content: { mod: "preview-plus-driver", props: { base: path.join(base, "control") } } }
] };
await fs.writeFile(path.join(app, "layouts/preview-plus-test.json"), JSON.stringify(layout, null, 2));
const overrides = ["HERDR_APP_HOME", "XDG_STATE_HOME", "XDG_CONFIG_HOME", "HC_SESSION", "HERDR_TELEMETRY"];
await execute("/usr/bin/open", ["-n", "-a", bundle, ...overrides.flatMap(key => ["--env", `${key}=${env[key]}`]), "--stdout", path.join(base, "app.log"), "--stderr", path.join(base, "app.log")]);
let ready = false;
for (let n = 0; n < 100; n++) {
  try { await execute(cli, ["status"], { env }); ready = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
}
if (!ready) throw new Error(`Disposable Herdr did not start: ${base}/app.log`);
const first = JSON.parse((await execute(cli, ["do", "space.new", JSON.stringify({ name: "Preview Plus", folder: project, argv: ["/bin/zsh", "-f"] })], { env })).stdout);
await execute(cli, ["do", "layout.switch", JSON.stringify({ name: "preview-plus-test" })], { env });
await execute(cli, ["do", "overlay.close", JSON.stringify({ id: "frame-welcome" })], { env });
const info = { base, app, project, bundle, first, env: Object.fromEntries(overrides.map(key => [key, env[key]])) };
await fs.writeFile(path.join(base, "session.json"), JSON.stringify(info, null, 2));
console.log(JSON.stringify(info, null, 2));
