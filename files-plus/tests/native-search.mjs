// Run only against a root-coordinated disposable native session, after permission.
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile), info = JSON.parse(await fs.readFile(process.argv[2], "utf8"));
assert.ok(info.base.startsWith("/tmp/fp."));
assert.equal(path.resolve(info.app), path.resolve(info.base, "app"));
assert.equal(path.resolve(info.env.HERDR_APP_HOME), path.resolve(info.app));
const base = info.base, env = { ...process.env, ...info.env }, driver = info.driverMod || "files-plus-driver";
const command = async (name, args = {}) => JSON.parse((await execute("herdr-app", ["do", name, JSON.stringify(args)], { env })).stdout);
const state = () => fs.readFile(path.join(base, "native-state-panel.json"), "utf8").then(JSON.parse);
async function until(read, accept, description) {
  let value;
  for (let attempt = 0; attempt < 150; attempt++) {
    try { value = await read(); if (accept(value)) return value; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`${description}: ${JSON.stringify(value).slice(0, 1800)}`);
}
async function request(value) {
  await fs.rm(path.join(base, "receipt.json"), { force: true });
  await fs.writeFile(path.join(base, "request.json"), JSON.stringify(value));
  await command(`${driver}.test`);
  const reply = await until(() => fs.readFile(path.join(base, "receipt.json"), "utf8").then(JSON.parse), () => true, "request receipt");
  assert.equal(reply.error, undefined); return reply;
}
async function search(query) {
  await request({ type: "search", query, focus: true });
  return until(state, value => value.search?.query === query && !value.search.busy, "search settles");
}
async function file(root, relative) {
  const target = path.join(root, relative); await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, relative + "\n"); return target;
}

const checks = [], shots = [];
await request({ type: "back" });
await request({ type: "workspace", file: null });
const initial = await until(state, value => value.location?.cwd && !value.location.entry, "single-folder context");
const single = initial.location.cwd;
assert.ok(single.startsWith(base + "/"), "Fixture writes stay in the disposable session");
const deep = await file(single, "search-fixture/unopened/deep/Single needle.txt");
const expanded = initial.folders;
let current = await search("unopened SINGLE");
assert.equal(current.search.results.length, 1); assert.equal(current.search.results[0].path, deep);
assert.deepEqual(current.folders, expanded);
checks.push("single-folder search reaches unopened paths without expansion");

const roots = [path.join(base, "search-web"), path.join(base, "search-api")];
for (const root of roots) await file(root, "src/deep/Same.txt");
const workspace = path.join(base, "search.herdr-workspace.json");
await fs.writeFile(workspace, JSON.stringify({ folders: roots.map(root => ({ path: root, name: path.basename(root) })) }));
await request({ type: "workspace", file: workspace });
current = await search("src/deep SAME");
assert.equal(current.search.results.length, 2);
assert.deepEqual(current.search.results.map(result => result.root), roots);
assert.equal(new Set(current.search.results.map(result => result.key)).size, 2);
checks.push("multi-root search preserves identical-path identities");

await request({ type: "activate" });
const shot = path.join(base, "search-results.png"); await execute("herdr-app", ["shot", shot], { env }); shots.push(shot);
await request({ type: "search-key", key: "down" });
await until(state, value => value.search?.at === 1, "second result selected");
await request({ type: "open-location", value: "internal" });
await request({ type: "search-key", key: "enter" });
await until(state, value => value.file === path.join(roots[1], "src/deep/Same.txt") && value.preview, "selected result opens");
await request({ type: "back" });
await request({ type: "search-key", key: "escape" });
await until(state, value => value.search?.query === "" && !value.file, "Escape restores tree");
checks.push("driver selection, Enter and Escape use the search control actions");

current = await search("no-matching-file"); assert.equal(current.search.results.length, 0); assert.equal(current.search.failures, 0);
await fs.rm(roots[1], { recursive: true });
current = await search("Same.txt"); assert.equal(current.search.results.length, 1); assert.ok(current.search.failures > 0);
checks.push("empty and partial-error search states");
await Promise.all(Array.from({ length: 205 }, (_, i) => file(roots[0], `many/match-${i}.txt`)));
current = await search("many/match"); assert.equal(current.search.results.length, 200); assert.equal(current.search.truncated, true);
checks.push("result cap reports truncation");

await request({ type: "search", query: "" });
const status = JSON.parse((await execute("herdr-app", ["status"], { env })).stdout);
assert.deepEqual(status.errors, []);
const report = { checks, shots, status, remaining: "Inspect search-results.png and use real input for typing, arrows, Enter, Escape and Clear; driver commands do not prove physical input dispatch." };
await fs.writeFile(path.join(base, "search-report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
