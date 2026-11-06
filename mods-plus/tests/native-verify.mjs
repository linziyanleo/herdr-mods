// Run only after root launches the prepared disposable home, with native/core permission.
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const info = JSON.parse(await fs.readFile(process.argv[2], "utf8"));
assert.ok(info.base.startsWith("/tmp/mp."));
assert.equal(info.app, path.join(info.base, "app"));
assert.equal(info.env.HERDR_APP_HOME, info.app);
const env = { ...process.env, ...info.env }, execute = promisify(execFile);
const cli = args => execute("herdr-app", args, { env });
const read = file => fs.readFile(file, "utf8").then(JSON.parse);
const until = async fn => {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try { const value = await fn(); if (value) return value; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Native fixture did not settle");
};
let serial = 0;
async function request(action, values = {}) {
  const id = `${Date.now()}-${++serial}`;
  await fs.writeFile(path.join(info.control, "request.json"), JSON.stringify({ id, action, ...values }));
  const receipt = await until(async () => { const value = await read(path.join(info.control, "receipt.json")); return value.id === id && value; });
  assert.equal(receipt.error, null);
  return receipt;
}
const shot = name => cli(["shot", path.join(info.base, name + ".png")]);
await cli(["status"]);
await cli(["do", "layout.switch", "--name", info.layout]);
await until(() => read(path.join(info.control, "state.json")));
await request("activate");
await request("discover");
await shot("import");
await request("details", { package: "fixture/packages/one" });
await request("review");
await shot("install-review");
await request("cancel");
assert.equal(await fs.stat(path.join(info.app, "mods/review-fixture")).catch(() => null), null);
await request("review");
await request("install");
assert.equal(await fs.stat(path.join(info.app, "mods/review-fixture")).catch(() => null), null);
assert.equal((await read(path.join(info.app, "keys.json"))).global["cmd-shift-x"], "app.palette");
await shot("installed");
await request("enable");
assert.equal((await read(path.join(info.app, "keys.json"))).global["cmd-shift-y"], "mod.open:review-fixture");
const fixtureFile = path.join(info.app, "mods-plus-fixture.json"), fixture = await read(fixtureFile);
fixture.commit = "b".repeat(40);
fixture.files["one/mods/review-fixture/main.js"] = fixture.files["one/mods/review-fixture/main.js"].replace("Fixture v1", "Fixture v2");
await fs.writeFile(fixtureFile, JSON.stringify(fixture, null, 2));
await request("check");
await request("review");
await shot("update-review");
const keys = await read(path.join(info.app, "keys.json"));
keys.global["cmd-shift-y"] = "app.help";
await fs.writeFile(path.join(info.app, "keys.json"), JSON.stringify(keys));
const stale = await request("apply");
assert.match(stale.message, /changed since review/);
assert.match(await fs.readFile(path.join(info.app, "mods/review-fixture/main.js"), "utf8"), /Fixture v1/);
await request("review");
await request("apply");
assert.match(await fs.readFile(path.join(info.app, "mods/review-fixture/main.js"), "utf8"), /Fixture v2/);
assert.equal((await read(path.join(info.app, "keys.json"))).global["cmd-shift-y"], "app.help");
await request("remove");
await request("remove");
assert.equal(await fs.stat(path.join(info.app, "mods/review-fixture")).catch(() => null), null);
await fs.writeFile(path.join(info.base, "native-report.json"), JSON.stringify({ passed: [
  "multi-package discovery", "review cancellation", "install without activation", "shortcut conflict preservation",
  "enable", "prepared update review", "local drift refusal", "reviewed apply", "remove preserving rebound keys",
], pointerAcceptance: "Not exercised by this driver; root must inspect screenshots and native pointer/keyboard flows." }, null, 2));
console.log(path.join(info.base, "native-report.json"));
