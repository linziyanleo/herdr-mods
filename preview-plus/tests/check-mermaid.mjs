import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
await fs.mkdir(path.join(root, ".build"), { recursive: true });
const dir = await fs.mkdtemp(path.join(root, ".build/mermaid-check-"));
try {
  await fs.copyFile(path.join(root, "tests/renderer-probe/main.js"), path.join(dir, "main.js"));
  await fs.copyFile(path.join(root, "mods/preview-plus/mermaid.bundle.js"), path.join(dir, "mermaid.bundle.js"));
  execFileSync("herdr-app", ["check", dir], { stdio: "inherit" });
} finally { await fs.rm(dir, { recursive: true, force: true }); }
