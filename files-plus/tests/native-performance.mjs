import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile), info = JSON.parse(await fs.readFile(process.argv[2], "utf8"));
assert.ok(info.base.startsWith("/tmp/fp."));
assert.equal(path.resolve(info.app), path.resolve(info.base, "app"), "Native verification requires a disposable Herdr home");
assert.equal(path.resolve(info.env.HERDR_APP_HOME), path.resolve(info.app));
const env = { ...process.env, ...info.env }, base = info.base;
const command = (name, args = {}) => execute("herdr-app", ["do", name, JSON.stringify(args)], { env });
async function until(read, accept) {
  for (let n = 0; n < 200; n++) {
    try { const value = await read(); if (accept(value)) return value; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Native performance fixture did not settle");
}
async function request(value) {
  await fs.rm(path.join(base, "receipt.json"), { force: true });
  await fs.writeFile(path.join(base, "request.json"), JSON.stringify(value));
  await command("files-plus-driver.test");
  return until(async () => JSON.parse(await fs.readFile(path.join(base, "receipt.json"), "utf8")), receipt => receipt.type === value.type);
}
const send = request;
const roots = [];
for (let n = 0; n < 11; n++) {
  const folder = path.join(base, "project", `root-${n}`); roots.push({ path: folder, name: `Root ${n}` });
  await fs.mkdir(folder, { recursive: true });
  await Promise.all(Array.from({ length: 500 }, (_, index) => fs.writeFile(path.join(folder, `file-${String(index).padStart(3, "0")}.txt`), "")));
  await execute("git", ["init", "-q", folder]);
}
await send({ type: "workspace", workspace: { name: "Large fixture", file: null, folders: roots } });
await command("window.maximize");
const state = () => fs.readFile(path.join(base, "performance-state.json"), "utf8").then(JSON.parse);
const settled = value => value.entryCount === 5000 && !value.error && value.visible === true && !value.loading && !value.pending && !value.gitPending && !value.changePending;
await until(state, settled);
await new Promise(resolve => setTimeout(resolve, 1000));
await until(state, settled);
await send({ type: "reset" });
console.log(`Measuring 60 seconds in ${base}`);
await new Promise(resolve => setTimeout(resolve, 30000));
console.log("30 seconds sampled");
await new Promise(resolve => setTimeout(resolve, 30000));
const sample = await until(state, value => value.at - value.stats.since >= 60000);
assert.equal(sample.entryCount, 5000); assert.equal(sample.error, null); assert.equal(sample.visible, true);
const status = JSON.parse((await execute("herdr-app", ["status"], { env })).stdout); assert.deepEqual(status.errors, []);
const report = { ...sample, elapsedMs: sample.at - sample.stats.since, errors: status.errors, fixture: "11 roots x 500 files; 5000 loaded entries" };
await fs.writeFile(path.join(base, "idle-performance.json"), JSON.stringify(report, null, 2));
await send({ type: "fps" });
await execute("herdr-app", ["shot", path.join(base, "native-fps.png")], { env });
console.log(JSON.stringify(report));
