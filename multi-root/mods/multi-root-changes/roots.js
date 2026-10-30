import { home, spaces, machines, window, shared, setShared, exec, readTextFile } from "herdr";

export const SPACES = "multi-root.spaces", REPO = "multi-root.repo", RECENT = "multi-root.recent";
export const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];
export const basename = path => path.split("/").filter(Boolean).pop() || "/";
export const dirname = path => path.slice(0, path.lastIndexOf("/")) || "/";
export const label = folder => folder.name || basename(folder.path);
export const shortPath = path => path === home() ? "~" : path.startsWith(home() + "/") ? "~" + path.slice(home().length) : path;

export function resolvePath(base, path) {
  if (path === "~" || path.startsWith("~/")) path = home() + path.slice(1);
  if (!path.startsWith("/")) path = base + "/" + path;
  const parts = [];
  for (const part of path.split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  return "/" + parts.join("/");
}

export function relativePath(fromDir, to) {
  const from = resolvePath("/", fromDir).split("/").filter(Boolean), dest = resolvePath("/", to).split("/").filter(Boolean);
  let i = 0;
  while (i < from.length && from[i] === dest[i]) i++;
  return [...from.slice(i).map(() => ".."), ...dest.slice(i)].join("/") || ".";
}

const contains = (root, path) => path === root || path.startsWith(root === "/" ? "/" : root + "/");
export function rootOf(cwd, folders) {
  if (!cwd) return null;
  let match = null, length = -1;
  for (const folder of folders) for (const path of [folder.path, folder.physical]) {
    if (path && contains(path, cwd) && path.length > length) { match = folder; length = path.length; }
  }
  return match;
}

export function parseConfig(text, file) {
  let raw;
  try { raw = JSON.parse(text); } catch { throw new Error("Invalid workspace JSON"); }
  if (!raw || !Array.isArray(raw.folders)) throw new Error("The workspace needs a folders array");
  const folders = [], seen = new Set();
  for (const item of raw.folders) {
    const source = typeof item === "string" ? item : item?.path;
    if (typeof source !== "string" || !source.trim()) throw new Error("Each folder needs a path");
    if (typeof item === "object" && item.name != null && typeof item.name !== "string") throw new Error("Folder names must be text");
    const path = resolvePath(dirname(file), source);
    if (seen.has(path)) continue;
    seen.add(path);
    folders.push({ name: typeof item === "object" ? item.name || null : null, path, source });
  }
  if (raw.name != null && typeof raw.name !== "string") throw new Error("The workspace name must be text");
  return { name: raw.name || basename(file).replace(/\.herdr-workspace\.json$/, ""), folders, raw };
}

export function putShared(key, value) {
  if (JSON.stringify(shared(key)) !== JSON.stringify(value)) setShared(key, value);
}
export function setWorkspace(id, value) {
  putShared(SPACES, { ...(shared(SPACES) || {}), [id]: value });
}
export function workspaceOf(spaceId) {
  const space = spaces().find(s => s.id === spaceId);
  return space?.machine === null && window()?.platform !== "windows" ? shared(SPACES)?.[spaceId] || null : null;
}
export function prune() {
  if (!machines().some(m => m.name === null && m.layout === "ready")) return;
  const ids = new Set(spaces().map(s => s.id));
  for (const key of [SPACES, REPO]) {
    const value = shared(key);
    if (value) putShared(key, Object.fromEntries(Object.entries(value).filter(([id]) => ids.has(id))));
  }
}
export function remember(file) {
  putShared(RECENT, [file, ...(shared(RECENT) || []).filter(path => path !== file)].slice(0, 10));
}
export async function loadConfig(file) {
  const text = await readTextFile(file);
  if (text === null) throw new Error("Workspace file not found");
  return { ...parseConfig(text, file), text };
}
export async function reloadWorkspace(id) {
  const entry = workspaceOf(id);
  if (!entry?.file) return null;
  try {
    const snapshot = await loadConfig(entry.file);
    if (workspaceOf(id)?.file === entry.file) setWorkspace(id, { name: snapshot.name, file: entry.file, folders: snapshot.folders });
    return snapshot;
  } catch (error) {
    if (workspaceOf(id)?.file === entry.file) setWorkspace(id, { ...workspaceOf(id), error: error.message || String(error) });
    throw error;
  }
}

// The app reports physical cwd paths, while config paths keep their original spelling.
export async function describeRoots(folders) {
  return Promise.all(folders.map(async folder => {
    const physical = await exec("sh", ["-c", 'cd "$1" 2>/dev/null && pwd -P', "multi-root", folder.path]).catch(() => null);
    if (physical?.code !== 0) return { ...folder, exists: false, physical: null, top: null };
    const path = physical.stdout.trim();
    const top = await exec("git", [...READ, "rev-parse", "--show-toplevel"], { cwd: path }).catch(() => null);
    return { ...folder, exists: true, physical: path, top: top?.code === 0 ? top.stdout.trim() : null };
  }));
}

export async function repositories(folders) {
  const roots = await describeRoots(folders), seen = new Set(), rows = [];
  for (const folder of roots) {
    if (!folder.top) { rows.push({ ...folder, branch: "", count: 0 }); continue; }
    if (seen.has(folder.top)) continue;
    seen.add(folder.top);
    const git = args => exec("git", [...READ, ...args], { cwd: folder.top });
    const [branch, status] = await Promise.all([git(["branch", "--show-current"]), git(["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"])]);
    rows.push({ ...folder, name: folder.name || basename(folder.top), branch: branch.stdout.trim(), count: status.stdout.split("\0").filter(Boolean).length });
  }
  return rows;
}
