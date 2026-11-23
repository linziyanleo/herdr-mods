import { agents, exec, focused, panes, spaces, terminals, window, home, appHome, readTextFile, shared, setShared, run } from "herdr";
import { basename, dirname, joinPath, contains, relativePath, workspaceOf } from "./roots.js";
import { browsingFolder } from "./browsing.js";
import { textWidth } from "./metrics.js";

export function menuLayout(items, statusText, metrics, viewport, pointer, zoom = 1) {
  const width = Math.min(Math.floor(Math.max(188, viewport ? viewport.width / zoom - 16 : 10000)), Math.ceil(Math.max(188,
    Math.max(...items.map(item => textWidth(item.label, 13, metrics) + 20), statusText ? textWidth(statusText, 12, metrics) + 16 : 0) + 10)));
  const intrinsicHeight = items.length * 30 + items.filter(item => item.group).length * 9 + 10 + (statusText ? 24 : 0);
  const height = Math.min(intrinsicHeight, viewport ? Math.max(30, viewport.height / zoom - 16) : intrinsicHeight);
  const at = viewport && pointer ? {
    x: Math.max(8 * zoom, Math.min(pointer.x, viewport.width - width * zoom - 8 * zoom)),
    y: Math.max(8 * zoom, Math.min(pointer.y, viewport.height - height * zoom - 8 * zoom))
  } : pointer;
  return { width, height, ...(at ? { at } : {}) };
}

export const CLIPBOARD = "files-plus.clipboard", REVISION = "files-plus.revision";
const windows = on => !on && window().platform === "windows";
const destination = target => target.kind === "file" ? dirname(target.path) : target.path;
async function checked(command, args, on) {
  const result = await exec(command, args, { on });
  if (result.code !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || `${command} failed`);
  return result;
}
const shell = (script, args, on) => checked("sh", ["-c", script, "files-plus", ...args], on);
const powershell = (script, args) => checked("powershell", ["-NoProfile", "-NonInteractive", "-Command", `& { ${script.replace(/^(param\([^)]*\))/, "$1 $ErrorActionPreference='Stop';")} }`, ...args], null);

export function captureTarget(space, path, kind, root, on, physicalRoot = root) {
  const f = focused();
  let active = null;
  if (f?.space === space && f.terminal) active = { pane: f.pane, terminal: f.shown || f.terminal, cwd: f.cwd };
  else if (!f || f.space === space) {
    const tab = spaces().find(s => s.id === space)?.tabs.find(t => t.active);
    const candidates = panes().filter(p => p.tab === tab?.id && p.terminal);
    const pane = candidates.find(p => p.focused) || candidates.find(p => p.program?.agent) || candidates[0];
    if (pane) active = { pane: pane.pane, terminal: pane.shown || pane.terminal, cwd: pane.cwd };
  }
  return { space, path, kind, root, physicalRoot, on: on ?? null, active };
}
export function ensureTarget(target) {
  if (!spaces().some(s => s.id === target.space && s.machine === target.on)) throw new Error("The target space is no longer available");
}
export function reference(target) {
  if (/[\x00-\x1f\x7f]/.test(target.path)) throw new Error("File references cannot contain control characters");
  let cwd = target.active?.cwd;
  // Herdr reports physical terminal cwd paths; workspace roots keep their spelling.
  if (cwd && target.physicalRoot && contains(target.physicalRoot, cwd)) {
    const relative = relativePath(target.physicalRoot, cwd);
    cwd = relative === "." ? target.root : joinPath(target.root, relative);
  }
  const path = cwd && contains(target.root, cwd) && contains(cwd, target.path) ? relativePath(cwd, target.path) : target.path;
  return `@${/[\s'"\\]/.test(path) ? JSON.stringify(path) : path} `;
}
function workspaceContext(target) {
  const entry = workspaceOf(target.space);
  if (!entry || entry.error || browsingFolder(target.space, target.on)) return null;
  const paths = [...new Set(entry.folders.map(folder => folder.path))];
  if (paths.length < 2 || paths.some(path => /[\x00-\x1f\x7f-\x9f\u2028\u2029]/.test(path))) return null;
  const space = spaces().find(s => s.active && s.id === target.space && s.machine === target.on);
  const tab = space?.tabs.find(t => t.active)?.id, address = target.active?.terminal;
  if (!tab || !address || address.includes("/")) return null; // Declared workspaces are local.
  const focus = focused();
  if (focus && (focus.space !== space.id || focus.tab !== tab || focus.terminal && (focus.shown || focus.terminal) !== address)) return null;
  const agent = agents().find(a => a.address === address && a.space === space.id && a.tab === tab);
  if (agent?.status !== "idle" && agent?.status !== "done") return null;
  const terminal = terminals().find(t => t.address === address && t.state === "live");
  if (!terminal) return null;
  return { tab, file: entry.file ?? null, paths, app: agent.app ?? null, created: terminal.created_ms ?? null };
}

export function captureWorkspaceContext(target) {
  if (target.kind !== "root") return null;
  const context = workspaceContext(target);
  if (!context?.paths.includes(target.path)) return null;
  if (!focused()?.terminal && agents().filter(a => a.space === target.space && a.tab === context.tab).length !== 1) return null;
  return context;
}

export async function insertWorkspaceContext(target, cx, current) {
  const context = target.workspaceContext;
  const validate = () => {
    const live = current() && workspaceContext(target);
    if (!live || live.tab !== context.tab || live.file !== context.file || live.app !== context.app || live.created !== context.created ||
      JSON.stringify(live.paths) !== JSON.stringify(context.paths)) {
      throw new Error("The workspace roots or agent terminal changed. Reopen the root menu to try again.");
    }
  };
  // A single line also avoids passing a line break to agents using an unbracketed paste mode.
  await pasteCaptured(target, cx, () => {
    const roots = context.paths.map(path => JSON.stringify(path)).join(", ");
    return `This session is in a multi-root workspace with these root directories: ${roots}. Check each listed root for applicable harness or instruction files.`;
  }, validate);
}

export async function insertReference(target, cx) { await pasteCaptured(target, cx, () => reference(target)); }

async function pasteCaptured(target, cx, getText, validate) {
  ensureTarget(target);
  const active = target.active;
  if (!active?.terminal) throw new Error("There is no active terminal in this space");
  const machine = active.terminal.includes("/") ? active.terminal.split("/")[0] : null;
  if (machine !== target.on) throw new Error("The file and captured terminal are on different machines");
  const validateDestination = () => {
    ensureTarget(target);
    const space = spaces().find(s => s.id === target.space), tabs = new Set(space.tabs.map(t => t.id));
    if (active.pane && !panes().some(p => p.pane === active.pane && tabs.has(p.tab) && (p.shown || p.terminal) === active.terminal)) throw new Error("The target terminal is no longer available");
    validate?.();
  };
  validateDestination();
  const previous = cx.read_from_clipboard();
  const text = getText();
  // run() queues a command. Yield before reading focus or restoring clipboard text.
  run("pane.focus", { terminal: active.terminal });
  await cx.sleep(0);
  try {
    validateDestination();
    const destination = focused();
    if ((destination?.shown || destination?.terminal) !== active.terminal) throw new Error("Could not focus the target terminal");
    cx.write_to_clipboard(text);
    validateDestination();
    const receiving = focused();
    if ((receiving?.shown || receiving?.terminal) !== active.terminal) throw new Error("The target terminal changed before paste");
    run("terminal.paste");
    await cx.sleep(0);
  } finally { if (previous !== undefined && cx.read_from_clipboard() === text) cx.write_to_clipboard(previous); }
}
export function validateName(name) {
  if (!name.trim() || name === "." || name === ".." || /[/\\\x00-\x1f\x7f]/.test(name)) throw new Error("Enter a name without path separators or control characters");
  return name;
}
export async function exists(path, on) {
  if (windows(on)) {
    const result = await powershell('param($p) if (Test-Path -LiteralPath $p) { "yes" }', [path]);
    return result.stdout.trim() === "yes";
  }
  const result = await exec("sh", ["-c", '[ -e "$1" ] || [ -L "$1" ]', "files-plus", path], { on });
  if (result.code !== 0 && result.code !== 1) throw new Error(result.stderr || "Cannot check this path");
  return result.code === 0;
}
export async function availablePath(dir, name, kind, on) {
  const dot = kind === "file" ? name.lastIndexOf(".") : -1;
  const stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : "";
  for (let n = 0; n < 10000; n++) {
    const candidate = n === 0 ? name : `${stem} copy${n > 1 ? ` ${n}` : ""}${ext}`;
    const path = joinPath(dir, candidate);
    if (!await exists(path, on)) return path;
  }
  throw new Error("No available copy name in this folder");
}
export function changed() { setShared(REVISION, (Number(shared(REVISION)) || 0) + 1); }

export async function paste(target) {
  ensureTarget(target);
  const source = shared(CLIPBOARD), dir = destination(target);
  if (!source || source.on !== target.on) throw new Error("Copy an entry from the same machine first");
  if (source.kind !== "file") {
    if (contains(source.path, dir)) throw new Error("A folder cannot be pasted into itself or a descendant");
    // A symlink in the destination path must not bypass the directory-cycle check.
    if (!windows(target.on)) {
      const physical = await shell('cd -P "$1" && printf "%s\\0" "$PWD" && cd -P "$2" && printf "%s\\0" "$PWD"', [source.path, dir], target.on);
      const [src, dst] = physical.stdout.split("\0");
      if (contains(src, dst)) throw new Error("A folder cannot be pasted into itself or a descendant");
    }
  }
  if (!await exists(source.path, target.on)) throw new Error("The copied entry is no longer available");
  const path = await availablePath(dir, basename(source.path), source.kind, target.on);
  if (windows(target.on)) {
    await powershell('param($src,$dst) if (Test-Path -LiteralPath $dst) { throw "The destination already exists" }; Copy-Item -LiteralPath $src -Destination $dst -Recurse -ErrorAction Stop', [source.path, path]);
  } else await checked("cp", ["-R", "-P", "-n", source.path, path], target.on);
  changed();
  return path;
}

export async function createEntry(target, kind, name) {
  ensureTarget(target); validateName(name);
  const path = joinPath(destination(target), name);
  if (await exists(path, target.on)) throw new Error("An entry with this name already exists");
  if (windows(target.on)) {
    await powershell('param($p,$kind) if (Test-Path -LiteralPath $p) { throw "An entry with this name already exists" }; New-Item -Path $p -ItemType $kind -ErrorAction Stop | Out-Null', [path, kind === "file" ? "File" : "Directory"]);
  } else if (kind === "file") await shell('set -C; : > "$1"', [path], target.on);
  else await checked("mkdir", [path], target.on);
  changed();
  return path;
}

export async function renameEntry(target, name) {
  ensureTarget(target); validateName(name);
  if (target.kind === "root") throw new Error("Workspace roots cannot be renamed here");
  if (name === basename(target.path)) return target.path;
  const path = joinPath(dirname(target.path), name);
  if (await exists(path, target.on)) throw new Error("An entry with this name already exists");
  if (windows(target.on)) await powershell('param($p,$name) Rename-Item -LiteralPath $p -NewName $name -ErrorAction Stop', [target.path, name]);
  else await shell('mv -n "$1" "$2" && { [ ! -e "$1" ] && [ ! -L "$1" ]; }', [target.path, path], target.on);
  changed();
  return path;
}

export async function trashEntry(target) {
  ensureTarget(target);
  if (target.kind === "root" || target.path === target.root || /^[a-z]?:?\/$/i.test(target.path)) throw new Error("Workspace roots cannot be removed here");
  if (!target.on && window().platform === "macos") {
    const trash = joinPath(home(), ".Trash");
    await checked("mkdir", ["-p", trash], null);
    const path = await availablePath(trash, basename(target.path), target.kind, null);
    await shell('mv -n "$1" "$2" && { [ ! -e "$1" ] && [ ! -L "$1" ]; }', [target.path, path], null);
  } else if (windows(target.on)) await powershell('param($p) Remove-Item -LiteralPath $p -Recurse -Force -ErrorAction Stop', [target.path]);
  else await checked("rm", ["-rf", "--", target.path], target.on);
  changed();
}
export async function reveal(target) {
  ensureTarget(target);
  if (target.on !== null) throw new Error("Reveal is only available for local files");
  const platform = window().platform;
  if (platform === "macos") await checked("open", ["-R", target.path], null);
  else if (platform === "windows") await checked("explorer.exe", [`/select,${target.path.replace(/\//g, "\\")}`], null);
  else await checked("xdg-open", [dirname(target.path)], null);
}
export async function installed(name) { return await readTextFile(joinPath(appHome(), `mods/${name}/mod.json`)) !== null; }
export function menuItems(target) {
  const clip = shared(CLIPBOARD), root = target.kind === "root" || target.path === target.root;
  return [
    { id: "agent", label: "Add to agent (@)", enabled: Boolean(target.active?.terminal) },
    ...(target.workspaceContext ? [{ id: "workspace-context", label: "Paste workspace roots to agent", enabled: true }] : []),
    { id: "copy", label: "Copy", enabled: true },
    { id: "paste", label: "Paste", enabled: Boolean(clip && clip.on === target.on) },
    { id: "path", label: "Copy path", enabled: true },
    { id: "relative", label: "Copy relative path", enabled: true },
    { id: "reveal", label: window().platform === "macos" ? "Reveal in Finder" : window().platform === "windows" ? "Reveal in File Explorer" : "Reveal in file manager", enabled: target.on === null },
    { id: "new-file", label: "New file…", enabled: true, group: true },
    { id: "new-folder", label: "New folder…", enabled: true },
    { id: "rename", label: "Rename…", enabled: !root },
    { id: "trash", label: "Move to Trash…", enabled: !root, danger: true },
    ...(root ? [
      { id: "new-here", label: "New terminal here", enabled: true, group: true },
      { id: "remove-root", label: "Remove from workspace", enabled: (workspaceOf(target.space)?.folders.length || 0) > 1 }
    ] : [])
  ];
}
