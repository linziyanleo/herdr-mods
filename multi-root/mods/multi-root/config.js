import { readTextFile, writeTextFile } from "herdr";
import { dirname, resolvePath, relativePath, parseConfig, reloadWorkspace, workspaceOf, setWorkspace, remember } from "./roots.js";

export async function saveWorkspace(id, folders, snapshot, file = workspaceOf(id).file) {
  const entry = workspaceOf(id), raw = snapshot ? { ...snapshot.raw } : { name: entry.name };
  const originals = new Map();
  for (const item of snapshot?.raw.folders || []) {
    const path = resolvePath(dirname(file), typeof item === "string" ? item : item.path);
    if (!originals.has(path)) originals.set(path, item);
  }
  raw.folders = folders.map(folder => originals.has(folder.path) ? originals.get(folder.path) : {
    path: relativePath(dirname(file), folder.path), ...(folder.name ? { name: folder.name } : {})
  });
  const text = JSON.stringify(raw, null, 2) + "\n", expected = snapshot?.text ?? null;
  try { await writeTextFile(file, text, expected); }
  catch (error) {
    if (await readTextFile(file) !== expected) {
      if (!entry.file) throw new Error("A workspace file with this name already exists here.");
      await reloadWorkspace(id).catch(() => null);
      const message = "The workspace file changed on disk. Reloaded.";
      setWorkspace(id, { ...workspaceOf(id), error: message });
      throw new Error(message);
    }
    throw error;
  }
  const parsed = parseConfig(text, file);
  setWorkspace(id, { name: parsed.name, file, folders: parsed.folders });
  remember(file);
  return { ...parsed, text };
}
