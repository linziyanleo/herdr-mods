// Prepare only. Root owns serial window launch, core permission and teardown.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const base = await fs.mkdtemp("/tmp/mp."), app = path.join(base, "app"), control = path.join(app, "data", "native-control");
const runtime = fileURLToPath(new URL("../mods/mods-plus/", import.meta.url));
const driver = path.join(app, "mods/mods-plus-driver");
await fs.mkdir(driver, { recursive: true });
await fs.mkdir(control, { recursive: true });
await fs.mkdir(path.join(app, "layouts"), { recursive: true });
for (const name of ["main.js", "mod.json", "helper.py", "catalog.py", "review.py", "star.svg"]) {
  await fs.copyFile(path.join(runtime, name), path.join(driver, name === "main.js" ? "panel.js" : name));
}
await fs.copyFile(fileURLToPath(new URL("native-driver.js", import.meta.url)), path.join(driver, "main.js"));
await fs.copyFile(fileURLToPath(new URL("fixture-helper.py", import.meta.url)), path.join(driver, "fixture-helper.py"));
await fs.writeFile(path.join(driver, "mod.json"), '{"place":"none"}');
const render = path.join(app, "mods/mods-plus-render");
await fs.mkdir(render, { recursive: true });
await fs.copyFile(path.join(runtime, "main.js"), path.join(render, "panel.js"));
await fs.copyFile(fileURLToPath(new URL("native-render.js", import.meta.url)), path.join(render, "main.js"));
await fs.writeFile(path.join(render, "mod.json"), '{"place":"none"}');
await fs.mkdir(path.join(app, "mods/mods-plus"), { recursive: true });
for (const name of ["main.js", "mod.json", "helper.py", "catalog.py", "review.py", "star.svg"]) {
  await fs.copyFile(path.join(runtime, name), path.join(app, "mods/mods-plus", name));
}
const files = {
  "one/RECIPE.md": "# Review fixture\nA local package for native acceptance.",
  "one/mods/review-fixture/main.js": 'import {View,div} from "gpui-kit"; export default class Fixture extends View { render(){ return div().text_size(13).child("Fixture v1"); } }',
  "one/mods/review-fixture/mod.json": '{"place":"none"}',
  "one/keys.json": '{"global":{"cmd-shift-x":"mod.open:review-fixture","cmd-shift-y":"mod.open:review-fixture"}}',
  "two/RECIPE.md": "# Layout fixture",
  "two/layouts/review-fixture.json": '{"id":"root","type":"block","content":{"mod":"review-fixture"}}',
};
const blob = value => createHash("sha1").update(`blob ${Buffer.byteLength(value)}\0`).update(value).digest("hex");
await fs.writeFile(path.join(app, "mods-plus-fixture.json"), JSON.stringify({ commit: "a".repeat(40), files,
  baseline: Object.fromEntries(Object.values(files).map(value => [blob(value), value])) }, null, 2));
await fs.writeFile(path.join(app, "keys.json"), '{"global":{"cmd-shift-x":"app.palette"}}');
await fs.writeFile(path.join(app, "settings.json"), JSON.stringify({ telemetry: false, sounds: { enabled: false } }));
await fs.writeFile(path.join(app, "shared.json"), JSON.stringify({ "frame.welcomed": "skipped" }));
await fs.writeFile(path.join(app, "layouts/mods-plus-test.json"), JSON.stringify({ id: "root", type: "block",
  content: { mod: "mods-plus-driver", props: { control } } }, null, 2));
const info = { base, app, control, layout: "mods-plus-test", env: { HERDR_APP_HOME: app, XDG_STATE_HOME: path.join(base, "s"),
  XDG_CONFIG_HOME: path.join(base, "c"), HC_SESSION: "mp", HERDR_TELEMETRY: "0" } };
await fs.writeFile(path.join(base, "session.json"), JSON.stringify(info, null, 2));
console.log(JSON.stringify(info, null, 2));
