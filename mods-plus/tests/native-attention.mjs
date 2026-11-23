// Run after launching the --attention fixture in a background Herdr instance.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

const info = JSON.parse(await fs.readFile(process.argv[2], "utf8"));
assert.ok(info.base.startsWith("/tmp/mp."));
assert.equal(info.env.HERDR_APP_HOME, path.join(info.base, "app"));
const cli = args => promisify(execFile)(process.env.MODS_PLUS_HERDR || "herdr-app", args,
  { env: { ...process.env, ...info.env } });
const read = async file => JSON.parse(await fs.readFile(file, "utf8"));
const data = path.join(info.app, "data/mods-plus");
const recordsFile = path.join(data, "packages.json");
async function until(fn) {
  for (let tries = 0; tries < 250; tries++) {
    const result = await fn().catch(error => { if (error.code !== "ENOENT") throw error; });
    if (result) return result;
    await delay(100);
  }
  throw new Error("Native fixture did not settle");
}
let serial = 0;
async function request(action, values = {}) {
  const id = `${Date.now()}-${++serial}`;
  await fs.writeFile(path.join(info.control, "request.json"), JSON.stringify({ id, action, ...values }));
  const receipt = await until(async () => {
    const value = await read(path.join(info.control, "receipt.json"));
    return value.id === id && value;
  });
  assert.equal(receipt.error, null);
  return receipt;
}
const state = filter => until(async () => {
  const value = await read(path.join(info.control, "state.json"));
  return !value.busy && filter(value) && value;
});
async function shot(name) {
  await delay(500);
  return cli(["shot", path.join(info.base, `${name}.png`)]);
}
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
async function snapshot() {
  const entries = {};
  async function visit(relative) {
    const target = path.join(info.app, relative);
    const stat = await fs.lstat(target);
    if (stat.isDirectory()) {
      entries[relative] = "directory";
      for (const name of await fs.readdir(target)) await visit(path.join(relative, name));
    } else if (stat.isSymbolicLink()) entries[relative] = await fs.readlink(target);
    else entries[relative] = sha(await fs.readFile(target));
  }
  for (const relative of ["mods", "layouts", "keys.json", "data/mods-plus/packages.json", "data/mods-plus/settings.json",
    "data/mods-plus/packages", "data/mods-plus/updates", "data/mods-plus/cache"]) await visit(relative);
  return entries;
}

await cli(["status"]);
await cli(["do", "mod.open", "--name", "mods-plus"]);
await state(value => value.view === "catalog" && value.packages.length >= 30);
const active = "fixture/packages/one", stored = "fixture/packages/two", offline = "fixture/offline";
for (const id of [active, stored]) {
  await request("discover");
  await request("details", { package: id });
  await request("review");
  await request("install");
  if (id === active) await request("enable");
}
const records = await read(recordsFile);
const offlineBytes = Buffer.from('{"id":"root","type":"block","content":{"mod":"tabs"}}');
const offlineBlob = createHash("sha1").update(`blob ${offlineBytes.length}\0`).update(offlineBytes).digest("hex");
records[offline] = { id: offline, repo: offline, ref: "main", installed: true, enabled: false, active_layouts: [],
  layouts: ["offline"], mods: [], files: {"layouts/offline.json": offlineBlob}, commit: "1".repeat(40) };
await fs.mkdir(path.join(data, "packages/fixture-offline/layouts"), { recursive: true });
await fs.writeFile(path.join(data, "packages/fixture-offline/layouts/offline.json"), offlineBytes);
await fs.writeFile(recordsFile, JSON.stringify(records));

const fixtureFile = path.join(info.app, "mods-plus-fixture.json"), fixture = await read(fixtureFile);
const localMod = path.join(info.app, "mods/review-fixture/main.js");
await fs.writeFile(localMod, fixture.files["one/mods/review-fixture/main.js"].replace("Fixture v1", "Local edit"));
fixture.commit = "b".repeat(40);
fixture.files["one/mods/review-fixture/main.js"] = fixture.files["one/mods/review-fixture/main.js"].replace("Fixture v1", "Fixture v2");
fixture.files["two/layouts/review-fixture.json"] = fixture.files["two/layouts/review-fixture.json"].replace('"root"', '"updated"');
await fs.writeFile(fixtureFile, JSON.stringify(fixture));
assert.match((await request("check")).message, /Could not check 1 package/);
assert.equal((await read(path.join(data, "settings.json"))).last_check, null);
await request("return");
await request("catalog-position", { query: "fixture", item: 7 });
await state(value => value.view === "catalog" && value.query === "fixture" && value.badge === 2);
await shot("catalog-before");

const cache = path.join(data, "cache/official-mods-index.json");
await fs.utimes(cache, 1, 1);
const before = await snapshot();
await request("installed");
const inventory = (await state(value => value.view === "installed" && value.installed)).installed;
assert.equal(inventory.cache, "stale");
const rows = Object.fromEntries(inventory.packages.map(row => [row.id, row]));
assert.equal(rows[active].activation, "active");
assert.match(rows[active].drift[0].path, /review-fixture\/main.js/);
assert.deepEqual(rows[active].candidate.conflicts, ["mods/review-fixture/main.js"]);
assert.equal(rows[stored].activation, "stored");
assert.equal(rows[stored].candidate.commit, fixture.commit);
assert.equal(rows[offline].check.state, "failed");
assert.equal(rows["local:mod:duplicate-source"].provenance, "ambiguous");
assert.equal(rows["local:mod:loose-clone"].provenance, "unknown");
assert.ok(inventory.packages.some(row => row.provenance === "built-in" && !row.attention));
assert.equal(Object.keys(await read(recordsFile)).length, 3);
await shot("installed-attention");

await request("installed-details", { package: active });
const details = await state(value => value.selected?.id === active && value.view === "details");
assert.equal(details.selected.inventory.source.branch, "main");
assert.deepEqual(details.selected.inventory.managed_keys, ["global / cmd-shift-y"]);
assert.match(details.selected.inventory.compare, /\/compare\/a{40}\.\.\.b{40}$/);
await shot("installed-active-details");
await request("return");
await state(value => value.view === "installed" && value.installed);
await request("installed-details", { package: "local:mod:duplicate-source" });
await state(value => value.view === "details" && value.selected?.inventory?.matches.length === 2);
await shot("installed-ambiguous-details");
await request("return");
await state(value => value.view === "installed" && value.installed);
await request("return");
await state(value => value.view === "catalog" && value.query === "fixture" && value.limit === 24 && value.badge === 2);
await shot("catalog-after");
assert.deepEqual(await snapshot(), before);

await fs.rename(cache, `${cache}.offline`);
await request("installed");
assert.equal((await state(value => value.installed)).installed.cache, "incomplete");
await fs.rename(`${cache}.offline`, cache);
await fs.utimes(cache, new Date(), new Date());
await request("return");
await request("installed");
await request("installed-details", { package: stored });
await request("review");
assert.equal((await state(value => value.review)).review.active, false);
await request("apply");
const updated = await state(value => value.selected?.inventory?.source?.commit === fixture.commit);
assert.equal(updated.selected.inventory.activation, "stored");
assert.equal(updated.badge, 1);
await assert.rejects(fs.stat(path.join(info.app, "layouts/review-fixture.json")), { code: "ENOENT" });
const status = JSON.parse((await cli(["status"])).stdout);
assert.deepEqual(status.errors, []);
console.log(`Native attention, details, unchanged files, and stored update passed. Screenshots in ${info.base}`);
