import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { runtime } from "./runtime.mjs";

async function setup(t, installed = true) {
  const r = await runtime(t), { default: Files } = await r.load("main.js");
  if (installed) {
    await fs.mkdir(path.join(r.dir, "app/mods/preview-plus"), { recursive: true });
    await fs.writeFile(path.join(r.dir, "app/mods/preview-plus/mod.json"), "{}");
  }
  const panel = new Files(); panel.init({}, r.cx); await r.drain();
  return { r, panel };
}

test("every file type opens in Preview Plus using the selected center destination", async t => {
  const { r, panel } = await setup(t);
  for (const destination of ["tab", "pane"]) {
    r.shared["files-plus.open-location"] = destination;
    for (const name of ["settings.json", "report.CSV", "values.tsv", "code.ts", "config.yaml", ".env", "Dockerfile", "notes.custom", "archive.zip", "photo.png", "guide.pdf"]) {
      const file = path.join(r.dir, name);
      panel.openFile(file, r.dir, r.cx); await r.drain();
      const call = r.calls.at(-1);
      assert.equal(call.command, destination === "tab" ? "tab.new" : "pane.split");
      assert.equal(call.args.mod, "preview-plus");
      assert.deepEqual({ ...call.args.props }, { file, root: r.dir, on: null });
      assert.equal(r.shared["preview-plus.target"], undefined);
    }
  }
});

test("all file types use the paired sidebar stack without changing another space target", async t => {
  const { r, panel } = await setup(t);
  r.props = { previewStack: "files" };
  r.shared["files-plus.open-location"] = "internal";
  const other = { file: "/other/data.json", root: "/other", on: null };
  r.shared["preview-plus.target"] = { other };
  for (const name of ["data.json", "src.ts", "Dockerfile", ".env", "unknown.format", "archive.zip"]) {
    const file = path.join(r.dir, name);
    panel.openFile(file, r.dir, r.cx); await r.drain();
    assert.equal(r.calls.at(-1).command, "layout.select");
    assert.deepEqual({ ...r.calls.at(-1).args }, { stack: "files", child: "preview-plus" });
    assert.deepEqual({ ...r.shared["preview-plus.target"].s1 }, { file, root: r.dir, on: null });
    assert.equal(r.shared["preview-plus.target"].other, other);
  }
});

test("structured data retains source fallback without Preview Plus or a sidebar pairing", async t => {
  const { r, panel } = await setup(t, false);
  const file = path.join(r.dir, "data.json");
  await fs.writeFile(file, '{"ready":true}\n');
  panel.openFile(file, r.dir, r.cx); await r.drain();
  assert.equal(r.calls.at(-1).args.mod, "files-plus");
  assert.equal(r.calls.at(-1).args.props.role, "preview");

  await fs.mkdir(path.join(r.dir, "app/mods/preview-plus"), { recursive: true });
  await fs.writeFile(path.join(r.dir, "app/mods/preview-plus/mod.json"), "{}");
  r.shared["files-plus.open-location"] = "internal";
  panel.openFile(file, r.dir, r.cx); await r.drain();
  assert.equal(panel.file, file);
  assert.equal(panel.previewText, '{"ready":true}\n');
  assert.equal(r.shared["preview-plus.target"], undefined);
});
