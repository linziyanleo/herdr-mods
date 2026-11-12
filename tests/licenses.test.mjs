import assert from "node:assert/strict";
import { readFile, readdir, access, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { rendererBanner } from "../preview-plus/build/notices.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = file => readFile(path.join(root, file), "utf8");
const mods = ["files-plus", "preview-plus", "mods-plus"];

test("MIT copies and third-party scope travel with every package and runtime", async () => {
  const license = await read("LICENSE");
  assert.match(license, /MIT License/);
  assert.match(license, /Third-party material/);
  for (const mod of mods) {
    assert.equal(await read(`${mod}/LICENSE`), license);
    assert.equal(await read(`${mod}/mods/${mod}/LICENSE`), license);
    assert.match(await read(`${mod}/mods/${mod}/THIRD_PARTY.md`), /\[MIT license\]\(LICENSE\)/);
  }
});

test("historical license files also accompany independently installed runtimes", async () => {
  for (const mod of ["files-plus", "preview-plus"]) {
    for (const file of await readdir(path.join(root, mod, "licenses"))) {
      assert.equal(await read(`${mod}/mods/${mod}/licenses/${file}`), await read(`${mod}/licenses/${file}`));
    }
  }
});

test("third-party notices use working local file links inside each runtime", async () => {
  for (const mod of mods) {
    const dir = path.join(root, mod, "mods", mod);
    const notice = await readFile(path.join(dir, "THIRD_PARTY.md"), "utf8");
    for (const [, link] of notice.matchAll(/\]\(([^)]+)\)/g)) {
      if (/^https?:/.test(link) || link.startsWith("#")) continue;
      const file = path.resolve(dir, link.split("#")[0]);
      assert.ok(file.startsWith(dir + path.sep), `Runtime link escapes package: ${link}`);
      await access(file);
    }
  }
});

test("Mermaid banner preserves both upstream elkjs copyright notices", async () => {
  const bundle = await read("preview-plus/mods/preview-plus/mermaid.bundle.js");
  const banner = rendererBanner("1.1.3");
  assert.ok(bundle.startsWith(banner + "\n"));
  for (const year of [2017, 2021]) assert.ok(banner.includes(`Copyright (c) ${year} Kiel University and others.`));
  assert.match(banner, /SPDX-License-Identifier: EPL-2\.0/);
  assert.match(await read("preview-plus/build/build.mjs"), /banner: \{ js: rendererBanner\(pkg.version\) \}/);
  const notice = await read("preview-plus/mods/preview-plus/THIRD_PARTY.md");
  assert.match(notice, /not yet been verified/);
  assert.doesNotMatch(notice, /complete editable source.*npm/);
});

test("Mods Plus installer includes license files without touching the user's app home", async () => {
  const base = await mkdtemp(path.join(tmpdir(), "herdr-licenses-"));
  try {
    const app = path.join(base, "app");
    const bin = path.join(base, "bin");
    await mkdir(bin);
    // Avoid launching the real host or changing an existing layout/shortcuts.
    await writeFile(path.join(bin, "herdr-app"), '#!/bin/sh\nif [ "$1" = status ]; then printf \'{"layout":"license-test"}\\n\'; fi\n', { mode: 0o755 });
    execFileSync("bash", [path.join(root, "mods-plus/install.sh")], {
      env: { ...process.env, HERDR_APP_HOME: app, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
      stdio: "pipe",
    });
    for (const file of ["LICENSE", "THIRD_PARTY.md"]) {
      assert.equal(await readFile(path.join(app, "mods/mods-plus", file), "utf8"), await read(`mods-plus/mods/mods-plus/${file}`));
    }
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
