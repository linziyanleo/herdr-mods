// Check the populated search UI without starting Herdr or contacting a core.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const folder = await fs.mkdtemp(path.join(os.tmpdir(), "files-plus-search-check-"));
try {
  await fs.cp(fileURLToPath(new URL("../mods/files-plus/", import.meta.url)), folder, { recursive: true });
  await fs.copyFile(fileURLToPath(new URL("./search-check.js", import.meta.url)), path.join(folder, "main.js"));
  const result = await promisify(execFile)("herdr-app", ["check", folder]);
  console.log(result.stdout.trim());
} finally { await fs.rm(folder, { recursive: true, force: true }); }
