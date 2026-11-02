// Compare the same JS render work with native shell execution excluded.
// Pass a baseline runtime directory; each pair runs in fresh, alternating processes.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { runtime } from "./runtime.mjs";

const execute = promisify(execFile);
if (process.argv[2] !== "--sample") {
  const baseline = process.argv[2];
  assert.ok(baseline, "Usage: node --experimental-vm-modules benchmark.mjs <baseline-runtime>");
  const current = fileURLToPath(new URL("../mods/files-plus", import.meta.url)), runs = { baseline: [], current: [] };
  for (let n = 0; n < 20; n++) for (const side of n % 2 ? ["current", "baseline"] : ["baseline", "current"]) {
    const result = await execute(process.execPath, ["--experimental-vm-modules", fileURLToPath(import.meta.url), "--sample"], { env: { ...process.env, FILES_PLUS_RUNTIME: side === "baseline" ? baseline : current } });
    runs[side].push(JSON.parse(result.stdout));
  }
  const summary = {};
  for (const [side, samples] of Object.entries(runs)) {
    summary[side] = {};
    for (const key of ["initial", "unrelated", "toggle"]) {
      const values = samples.map(sample => sample[key].ms).sort((a, b) => a - b);
      summary[side][key] = { medianMs: (values[9] + values[10]) / 2, minMs: values[0], maxMs: values.at(-1), rebuiltRows: [...new Set(samples.map(sample => sample[key].rebuiltRows))] };
    }
  }
  console.log(JSON.stringify({ runsPerSide: 20, fixture: "11 roots, 500 files each, 5000 loaded entries", node: process.version, cpus: os.cpus().length, load: os.loadavg(), errors: 0, scope: "VM JS builders and retained row materialization; excludes native layout/GPU/IO", summary, runs }, null, 2));
} else {
  const cleanup = [], r = await runtime({ after: fn => cleanup.push(fn) });
  try {
    const roots = Array.from({ length: 11 }, (_, n) => ({ path: path.join(r.dir, `root-${n}`) }));
    r.shared["multi-root.spaces"] = { s1: { name: "Large fixture", file: null, folders: roots } };
    r.hooks.exec = async (command, args) => {
      if (command === "git") return { code: 128, stdout: "", stderr: "Not a repository" };
      if (command === "sh") return { code: 0, stderr: "", stdout: args[1].startsWith("n=0") ? Array.from({ length: 500 }, (_, n) => `f\0file-${n}.txt\0`).join("") : args.at(-1) + "\n" };
    };
    const { default: Files } = await r.load("main.js"), panel = new Files(); panel.init({}, r.cx); await r.drain();
    assert.equal([...panel.entries.values()].reduce((n, rows) => n + rows.length, 0), 5000);
    function materialize(element) {
      if (!element || typeof element !== "object") return 0;
      if (Object.hasOwn(element, "snapshot")) return materialize(element.snapshot());
      return Number(String(element.attributes?.id?.[0] || "").startsWith("file-")) + (element.nodes || []).reduce((n, child) => n + materialize(child), 0);
    }
    const measure = action => {
      r.rowBuilds = 0; const start = performance.now(); action?.();
      const entries = materialize(panel.render(r.cx)), ms = performance.now() - start;
      return { ms, rebuiltRows: r.rowBuilds, entries };
    };
    const initial = measure(), unrelated = measure(), toggle = measure(() => panel.toggle(roots[0].path, r.cx));
    assert.equal(initial.entries, 5000); assert.equal(unrelated.entries, 5000); assert.equal(toggle.entries, 4500);
    console.log(JSON.stringify({ initial, unrelated, toggle, errors: 0 }));
  } finally { for (const fn of cleanup) await fn(); }
}
