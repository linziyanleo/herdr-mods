// Original build helper: MIT. The embedded elkjs notices retain their own terms.
import { readFileSync } from "node:fs";

export function rendererBanner(version) {
  const notice = readFileSync(new URL("../mods/preview-plus/licenses/elkjs-NOTICE.txt", import.meta.url), "utf8").trimEnd();
  if (notice.includes("*/")) throw new Error("elkjs notice cannot contain a JavaScript comment terminator");
  return `// beautiful-mermaid ${version} (MIT) with elkjs (EPL-2.0) and entities (BSD-2-Clause), bundled. Rebuild: node build/build.mjs\n/*!\n${notice}\n*/`;
}
