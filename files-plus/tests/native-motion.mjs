// Use a disposable session launched with native-session.mjs --motion.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile), base = process.argv[2];
assert.match(base || "", /^\/tmp\/fp\.[^/]+$/);
const session = JSON.parse(await fs.readFile(path.join(base, "session.json"), "utf8"));
assert.equal(session.app, path.join(base, "app"));
const env = { ...process.env, ...session.env };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const state = () => fs.readFile(path.join(base, "native-state-panel.json"), "utf8").then(JSON.parse);
async function until(read, accept) {
  for (let i = 0; i < 100; i++) {
    const value = await read();
    if (accept(value)) return value;
    await pause(50);
  }
  throw new Error("Native motion fixture did not settle");
}
async function send(request) {
  await fs.rm(path.join(base, "receipt.json"), { force: true });
  await fs.writeFile(path.join(base, "request.json"), JSON.stringify(request));
  await execute("herdr-app", ["do", "files-plus-driver.test"], { env });
  const receipt = await until(async () => {
    try { return JSON.parse(await fs.readFile(path.join(base, "receipt.json"), "utf8")); }
    catch { return null; }
  }, Boolean);
  assert.equal(receipt.error, undefined);
}

await send({ type: "activate" });
await until(state, value => value.windowActive === true);
const root = (await state()).location.cwd, many = path.join(root, "motion-many"), empty = path.join(root, "motion-empty");
await fs.mkdir(many, { recursive: true }); await fs.mkdir(empty, { recursive: true });
await Promise.all(Array.from({ length: 120 }, (_, n) => fs.writeFile(path.join(many, `file-${String(n).padStart(3, "0")}.txt`), "")));
await until(state, value => value.entries[root]?.some(entry => entry.name === "motion-many"));
const samples = {}, checks = [];
for (const [name, folder, keys] of [
  ["single", path.join(root, "src"), [path.join(root, "src/server.ts")]],
  ["empty", empty, [`empty-${empty}`]],
  ["chunks", many, [path.join(many, "file-000.txt"), path.join(many, "file-100.txt")]]
]) {
  if ((await state()).folders.includes(folder)) { await send({ type: "toggle", path: folder }); await pause(500); }
  for (const phase of ["expand", "collapse", "reopen"]) {
    await send({ type: "toggle", path: folder, motion: true });
    await pause(650);
    const value = await state(), label = `${name}-${phase}`;
    samples[label] = value.motion.filter(row => keys.includes(row.key));
    assert.equal(value.folders.includes(folder), phase !== "collapse");
    for (const key of keys) checks.push({ label, key, rows: samples[label].filter(row => row.key === key) });
    if (name === "chunks" && phase !== "collapse") assert.equal(value.entries[folder].length, 120);
  }
  await send({ type: "toggle", path: folder }); await pause(500);
}
const status = JSON.parse((await execute("herdr-app", ["status"], { env })).stdout);
assert.deepEqual(status.errors, []);
await execute("herdr-app", ["shot", path.join(base, "motion.png")], { env });
const report = { samples, errors: status.errors, windowActive: (await state()).windowActive };
await fs.writeFile(path.join(base, "motion-report.json"), JSON.stringify(report, null, 2));
for (const { label, key, rows } of checks) {
  assert.ok(rows.some(row => row.height > 0 && row.height < 28), `${label}: ${key} must produce intermediate native heights`);
  assert.equal(rows.at(-1).height, label.endsWith("collapse") ? 0 : 28, `${label}: ${key} must reach its target height`);
}
console.log(JSON.stringify({ cases: checks.length, errors: status.errors, report: path.join(base, "motion-report.json") }));
