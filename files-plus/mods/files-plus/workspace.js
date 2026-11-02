// Lazy tree and read-only preview adapted from Herdr files.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, watchFolder, settings, window as appWindow, props, shared, setShared, run, openOverlay, layout } from "herdr";
import { workspaceOf, describeRoots, reloadWorkspace, dirname, joinPath, label, shortPath, rootOf, relativePath, contains, READ } from "./roots.js";
import { captureTarget, installed, REVISION, menuLayout, menuItems } from "./actions.js";
import { palette } from "./palette.js";
import { visibleRows, TreeView, RowChunk, CHUNK_SIZE } from "./tree.js";
import { metrics, calibrationProbe, viewport, zoom, dialogLayout } from "./metrics.js";
import { panelWidth, fittedWidth, shouldFit, findNode } from "./fit.js";
import { dragMove } from "./drag.js";

const PER_FOLDER = 500, TOTAL = 5000;
const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html", md: "markdown" };
const RICH = /\.(md|markdown|png|jpe?g|webp|svg|pdf)$/i;
const collator = globalThis.Intl?.Collator ? new globalThis.Intl.Collator() : { compare: (a, b) => a.localeCompare(b) };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function changedDirectories(paths, roots, expanded) {
  const directories = new Set(); let git = false;
  for (const source of paths) for (const root of roots) {
    const base = [root.path, root.physical].filter(Boolean).find(path => contains(path, source));
    if (!base) continue;
    const path = root.path + source.slice(base.length), relative = relativePath(root.path, path);
    if (relative === ".git" || relative.startsWith(".git/")) {
      if (/^\.git\/(HEAD|index|packed-refs|refs(?:\/.*)?)$/.test(relative) && !relative.endsWith(".lock")) git = true;
      continue;
    }
    git = true;
    if (expanded.has(dirname(path))) directories.add(dirname(path));
    if (expanded.has(path)) directories.add(path);
  }
  return { paths: directories, git };
}

export function location() {
  const space = spaces().find(s => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const cwd = (f?.space === space?.id ? pane?.cwd || f?.cwd : null) || space?.folder;
  const on = f && space && f.space === space.id && f.pane === null && f.terminal ? (f.terminal.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  const entry = workspaceOf(space?.id);
  return { space: space?.id, cwd, on, entry, key: entry ? JSON.stringify([space.id, entry.folders]) : JSON.stringify([space?.id, cwd, on]) };
}

export async function directory(path, on) {
  if (!on && appWindow().platform === "windows") {
    const r = await exec("powershell", ["-NoProfile", "-NonInteractive", "-Command", "& { param($p) $ErrorActionPreference='Stop'; @(Get-ChildItem -LiteralPath $p -Force | Where-Object Name -ne '.git' | Select-Object -First 501 | ForEach-Object { @{ name=$_.Name; dir=($_.PSIsContainer -and -not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint)) } }) | ConvertTo-Json -Compress }", path]);
    if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
    const result = JSON.parse(r.stdout || "[]");
    return Array.isArray(result) ? result : [result];
  }
  const script = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; [ "$name" = .git ] && continue; if [ -d "$p" ] && [ ! -L "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt 500 ] && break; done; test -d "$1"';
  const r = await exec("sh", ["-c", script, "files-plus", path], { on });
  if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
  const fields = r.stdout.split("\0"), out = [];
  for (let i = 0; i + 1 < fields.length; i += 2) out.push({ name: fields[i + 1], dir: fields[i] === "d" });
  return out;
}

export class FilesPanel extends View {
  initPanel(cx) {
    this.entries = new Map(); this.folders = new Set(); this.pending = new Map(); this.watches = new Map(); this.marks = {};
    this.entryCount = 0; this.limits = new Set(); this.treeVersion = 0; this.chunks = []; this.gitCache = new Map();
    this.treeView = cx.new(TreeView, { chunks: [], panel: this });
    this.revision = shared(REVISION);
    this.refresh(cx);
    cx.timer.every(10000, cx => { if (this.on) this.refresh(cx); });
    cx.timer.every(60000, cx => { if (!this.on && this.visible !== false) this.refresh(cx, { recover: true }); });
  }
  watch(path, cx) {
    if (this.on || this.watches.has(path)) return;
    const token = {};
    this.watches.set(path, token);
    cx.spawn(async cx => {
      try {
        while (this.watches.get(path) === token) {
          const paths = await watchFolder(path);
          if (this.watches.get(path) === token) this.queueChanges(paths, cx);
        }
      } catch { if (this.watches.get(path) === token) this.watches.delete(path); }
    });
  }
  queueChanges(paths, cx) {
    this.changedPaths ||= new Set();
    for (const path of paths) this.changedPaths.add(path);
    if (this.changeTimer) return;
    const generation = this.generation, token = {};
    this.changeTimer = token;
    cx.timer.after(200, cx => {
      if (this.changeTimer !== token) return;
      this.changeTimer = false;
      if (generation !== this.generation) return;
      const changes = changedDirectories(this.changedPaths, this.rootInfo || [], this.folders);
      this.changedPaths.clear();
      if (changes.paths.size || changes.git) this.refresh(cx, changes);
    });
  }
  watchConfig(id, file, cx) {
    const token = file ? `${id}:${file}` : null;
    if (this.configWatch === token) return;
    this.configWatch = token;
    if (!file) return;
    cx.spawn(async cx => {
      try {
        await reloadWorkspace(id).catch(() => null);
        cx.notify();
        while (this.configWatch === token) {
          const paths = await watchFolder(dirname(file));
          if (this.configWatch !== token) return;
          if (paths.some(path => path === file || path.replace(/^\/private\/tmp\//, "/tmp/") === file)) { await reloadWorkspace(id).catch(() => null); this.refresh(cx, { describe: true }); }
        }
      } catch { if (this.configWatch === token) this.configWatch = null; }
    });
  }
  current(context, loc = location()) { return this.context === context && loc.key === context; }
  dropFolder(path) {
    this.entryCount -= this.entries.get(path)?.length || 0;
    const removed = this.entries.delete(path), limited = this.limits.delete(path);
    this.pending.delete(path); this.limited = this.limits.size > 0;
    return removed || limited;
  }
  async loadFolder(path, context) {
    if (!this.current(context) || !this.folders.has(path)) return false;
    const entries = this.entries, pending = this.pending, request = {};
    pending.set(path, request);
    try {
      const list = await directory(path, this.on);
      if (entries !== this.entries || pending.get(path) !== request || !this.current(context) || !this.folders.has(path)) return false;
      const used = this.entryCount - (this.entries.get(path)?.length || 0);
      const next = list.slice(0, Math.max(0, Math.min(PER_FOLDER, TOTAL - used))).sort((a, b) => Number(b.dir) - Number(a.dir) || collator.compare(a.name, b.name));
      if (!same(this.entries.get(path), next)) { this.entries.set(path, next); this.entryCount = used + next.length; this.treeVersion++; }
      if (list.length > next.length) this.limits.add(path); else this.limits.delete(path);
      for (const child of [...this.folders]) if (child !== path && dirname(child) === path && !next.some(entry => entry.dir && joinPath(path, entry.name) === child)) {
        for (const folder of [...this.folders]) if (contains(child, folder)) { this.folders.delete(folder); this.dropFolder(folder); }
      }
      this.limited = this.limits.size > 0;
      return true;
    } catch (error) {
      if (entries === this.entries && pending.get(path) === request && this.current(context)) throw error;
      return false;
    } finally { if (pending.get(path) === request) pending.delete(path); }
  }
  refresh(cx, options = {}) {
    const loc = location(), context = loc.key;
    if (context !== this.context) {
      this.context = context; this.spaceId = loc.space; this.root = loc.cwd; this.on = loc.on; this.workspace = loc.entry;
      this.entries = new Map(); this.folders = new Set(loc.entry ? loc.entry.folders.map(f => f.path) : loc.cwd ? [loc.cwd] : []);
      this.pending = new Map(); this.marks = {}; this.rootInfo = null; this.watches.clear(); this.show(null); this.error = null; this.loading = null;
      this.generation = {}; this.entryCount = 0; this.limits.clear(); this.gitCache.clear(); this.changedPaths = new Set(); this.changeTimer = false; this.gitTimer = null;
      this.refreshAgain = null; this.treeVersion++; this.selectedFile = null;
      this.manualWidthSpace = null; this.lastRequestedWidth = null; this.resizePending = null; this.fitSignature = null; this.fitCause = "user";
    }
    this.watchConfig(loc.space, loc.entry?.file, cx);
    if (this.loading === context) {
      const queued = this.refreshAgain;
      this.refreshAgain = !queued || !queued.paths || !options.paths ? { ...options, paths: undefined } : { ...options, paths: new Set([...queued.paths, ...options.paths]) };
      return;
    }
    this.syncTree(cx, loc);
    if (!loc.cwd && !loc.entry) return;
    const generation = this.generation, before = this.treeVersion, oldError = this.error, oldLimited = this.limited;
    this.loading = context; this.refreshAgain = null;
    cx.spawn(async cx => {
      try {
        const roots = !this.rootInfo || options.describe || (options.recover && this.rootInfo.some(root => !root.exists))
          ? await describeRoots(loc.entry?.folders || [{ path: loc.cwd }], loc.on) : this.rootInfo;
        if (!this.current(context) || generation !== this.generation) return;
        if (!same(roots, this.rootInfo)) this.treeVersion++;
        this.rootInfo = roots;
        // Drop entries for folders removed on disk so their budget can be reused.
        const queue = [...(options.paths || this.folders)], listing = queue.length > 0;
        let readError = null;
        await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
          while (queue.length && generation === this.generation) {
            const path = queue.shift(), root = rootOf(path, roots);
            if (!this.folders.has(path)) continue;
            if (!root || root.exists === false) { this.dropFolder(path); continue; }
            try { await this.loadFolder(path, context); }
            catch (error) {
              if (generation !== this.generation) return;
              if (this.dropFolder(path)) this.treeVersion++;
              if (path === root.path) readError = error.message || String(error);
              else if (this.folders.delete(path)) this.treeVersion++;
            }
          }
        }));
        const marks = {};
        const tops = [...new Set(roots.map(f => f.top).filter(Boolean))];
        for (const cwd of tops) {
          let cached = this.gitCache.get(cwd);
          const remaining = cached ? 2000 - (Date.now() - cached.at) : 0;
          if (remaining <= 0) {
            const status = await exec("git", [...READ, "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=normal"], { cwd, on: loc.on }).catch(() => null);
            if (generation !== this.generation) return;
            cached = { at: Date.now(), text: status?.code === 0 ? status.stdout : cached?.text || "" };
            this.gitCache.set(cwd, cached);
          } else if (!this.gitTimer) {
            const token = this.gitTimer = {};
            cx.timer.after(remaining, cx => { if (this.gitTimer !== token) return; this.gitTimer = null; if (generation === this.generation) this.refresh(cx, { paths: new Set(), git: true }); });
          }
          for (const item of cached.text.split("\0").filter(Boolean).slice(0, TOTAL)) {
            const xy = item.slice(0, 2), absolute = joinPath(cwd, item.slice(3));
            const mark = xy === "??" || xy.includes("A") ? "A" : xy.includes("U") ? "U" : xy.includes("D") ? "D" : "M";
            for (const root of roots) {
              const base = root.physical || root.path;
              if (contains(base, absolute)) marks[root.path + absolute.slice(base.length)] = mark;
            }
          }
        }
        if (!this.current(context) || generation !== this.generation) return;
        if (!same(this.marks, marks)) { this.marks = marks; this.treeVersion++; }
        if (listing) this.error = readError;
        for (const root of roots) if (root.exists) this.watch(root.path, cx);
        if (this.file) this.show(this.file, cx);
      } catch (error) { if (this.current(context) && generation === this.generation) this.error = error.message || String(error); }
      finally {
        if (generation === this.generation && this.loading === context) {
          this.loading = null;
          if (oldError !== this.error || oldLimited !== this.limited) this.treeVersion++;
          if (before !== this.treeVersion) { this.syncTree(cx); cx.notify(); }
          const again = this.refreshAgain; this.refreshAgain = null;
          if (again && this.current(context)) this.refresh(cx, again);
        }
      }
    });
  }
  toggle(path, cx) {
    this.fitCause = "user";
    if (this.folders.has(path)) {
      for (const folder of [...this.folders]) if (contains(path, folder)) { this.folders.delete(folder); this.dropFolder(folder); }
    } else {
      this.revealPath = path;
      this.folders.add(path);
      if (!this.entries.has(path) && !this.pending.has(path)) {
        const context = this.context, pending = this.pending;
        cx.spawn(async cx => {
          let completed = false;
          try { completed = await this.loadFolder(path, context); }
          catch (error) { if (this.current(context)) { completed = true; this.error = error.message || String(error); } }
          finally { if (completed && pending === this.pending) { this.fitCause = "user"; this.treeVersion++; this.syncTree(cx); this.revealPath = null; cx.notify(); } }
        });
      }
    }
    this.treeVersion++; this.syncTree(cx); cx.notify();
  }
  openFile(path, root, cx) {
    this.selectedFile = path; this.treeVersion++; this.syncTree(cx);
    const request = this.openRequest = {};
    const stack = props()?.previewStack, context = this.context, space = this.spaceId, on = this.on;
    if (!stack || !RICH.test(path)) { this.show(path, cx); return; }
    cx.spawn(async cx => {
      try {
        if (!await installed("preview-plus")) { if (this.current(context) && this.openRequest === request) this.show(path, cx); return; }
        if (!this.current(context) || this.openRequest !== request) return;
        setShared("preview-plus.target", { ...(shared("preview-plus.target") || {}), [space]: { file: path, root, on } });
        run("layout.select", { stack, child: "preview-plus" });
      } catch { if (this.current(context) && this.openRequest === request) this.show(path, cx); }
      cx.notify();
    });
  }
  show(path, cx) {
    const same = path && this.file === path;
    const previousError = this.fileError;
    let changed = !same;
    if (!same) { this.code?.release(); this.code = null; this.previewText = null; }
    this.file = path; this.fileError = null; this.openRequest = null;
    if (!same && cx) {
      this.previewEntered = false;
      if (!path) this.treeView.set_props({ chunks: this.chunks.map(chunk => chunk.entity), panel: this, entered: false });
      cx.timer.after(0, cx => {
        if (this.file !== path) return;
        this.previewEntered = true;
        if (!path) this.treeView.set_props({ chunks: this.chunks.map(chunk => chunk.entity), panel: this, entered: true });
        cx.notify();
      });
    }
    const request = this.previewRequest = {};
    if (!same && cx) cx.notify();
    if (!path || !cx) return;
    const context = this.context, on = this.on;
    cx.spawn(async cx => {
      try {
        const text = await readTextFile(path, { on });
        if (this.previewRequest !== request || !this.current(context)) return;
        if (text === null || text.includes("\0")) {
          changed = Boolean(this.code);
          this.code?.release(); this.code = null;
          this.fileError = text === null ? "This file is no longer available" : "Binary file, no text preview"; changed ||= this.fileError !== previousError; return;
        }
        const value = text.length > 400000 ? text.slice(0, 400000) + "\n… (file truncated)" : text;
        if (this.code && this.previewText === value) return;
        this.code?.release(); this.previewText = value; changed = true;
        const t = palette(), ext = path.split(".").pop().toLowerCase();
        this.code = EditorState.new({ language: LANG[ext] ?? ext, readonly: true, value,
          font_family: settings().font_family, font_size: 12, syntax: { keyword: t.purple, string: t.green, comment: t.muted, function: t.blue, type: t.amber, number: t.red, constant: t.blue } });
      } catch { if (this.previewRequest === request && this.current(context)) { changed = Boolean(this.code); this.code?.release(); this.code = null; this.fileError = "Cannot preview this file (binary, too large, or unreadable)"; changed ||= this.fileError !== previousError; } }
      finally { if (changed && this.previewRequest === request && this.current(context)) cx.notify(); }
    });
  }
  target(path, kind, root) { return captureTarget(this.spaceId, path, kind, root, this.on, this.rootInfo?.find(folder => folder.path === root)?.physical || root); }
  menu(path, kind, root, event, cx) {
    cx.stop_propagation();
    const target = this.target(path, kind, root), geometry = menuLayout(menuItems(target), "", metrics(), viewport(), event.position, zoom());
    openOverlay({ mod: "files-plus", kind: "popup", frame: "none", ...geometry, props: { role: "menu", target, geometry, pointer: event.position } });
  }
  syncTree(cx, loc = location()) {
    const roots = this.rootInfo || this.workspace?.folders || [];
    this.activeRoot = rootOf(loc.cwd, roots)?.path;
    const signature = JSON.stringify([this.treeVersion, this.activeRoot, settings().dark]);
    if (signature === this.treeSignature) return;
    this.treeSignature = signature;
    let rows = visibleRows(this);
    if (this.revealPath) {
      const previous = new Set((this.rowModel || []).map(row => row.key));
      this.fresh = new Set(rows.filter(row => row.path && contains(this.revealPath, row.path) && !previous.has(row.key)).map(row => row.path));
      rows = visibleRows(this);
      if (this.fresh.size && !this.freshTimer) {
        this.freshTimer = true;
        cx.timer.after(0, cx => { this.freshTimer = false; this.fresh.clear(); this.treeVersion++; this.syncTree(cx); });
      }
    }
    this.rowModel = rows;
    const t = palette();
    const count = Math.ceil(rows.length / CHUNK_SIZE), previous = this.chunks;
    const retained = new Map(previous.map(chunk => [chunk.id, chunk])), chunks = [];
    for (let index = 0; index < count; index++) {
      const part = rows.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE), key = JSON.stringify([part, t]);
      const id = part[0].id, data = { rows: part, panel: this, t }, chunk = retained.get(id);
      if (!chunk) chunks.push({ id, entity: cx.new(RowChunk, data), key });
      else {
        if (chunk.key !== key) { chunk.entity.set_props(data); chunk.key = key; }
        chunks.push(chunk); retained.delete(id);
      }
    }
    for (const chunk of retained.values()) chunk.entity.release();
    this.chunks = chunks;
    if (chunks.length !== previous.length || chunks.some((chunk, i) => chunk !== previous[i])) this.treeView.set_props({ chunks: chunks.map(chunk => chunk.entity), panel: this });
    this.scheduleFit(cx, this.fitCause || "background"); this.fitCause = "background";
  }
  panelTitle() { return this.workspace?.name || (this.root ? label({ path: this.root }) : ""); }
  scheduleFit(cx, cause = "background") {
    const fit = props()?.fit;
    if (!fit?.node || this.file) return;
    const signature = JSON.stringify([this.treeVersion, this.panelTitle(), metrics(), viewport(), zoom(), fit]);
    if (signature === this.fitSignature && cause !== "user") return;
    this.fitSignature = signature;
    const token = { context: this.context, cause: cause === "user" || this.fitTimer?.cause === "user" ? "user" : "background" };
    this.fitTimer = token;
    cx.timer.after(250, cx => {
      if (this.fitTimer !== token || token.context !== this.context || this.file || !this.visible || this.manualWidthSpace === this.spaceId) return;
      this.fitTimer = null;
      const tree = layout();
      if (!findNode(tree, fit.node)) return;
      const desired = fittedWidth(panelWidth(this.rowModel || [], this.panelTitle(), metrics()), fit, tree, viewport(), zoom());
      if (!shouldFit(desired, this.panelSize.width / zoom(), token.cause)) return;
      this.lastRequestedWidth = desired; this.resizePending = token;
      run("layout.resize", { id: fit.node, px: desired });
      cx.spawn(async cx => { await cx.sleep(0); cx.notify(); });
      cx.timer.after(500, () => { if (this.resizePending === token) this.resizePending = null; });
    });
  }
  panelResized(size, cx) {
    const previous = this.panelSize, view = JSON.stringify([viewport(), zoom()]);
    this.panelSize = size; this.visible = size.width > 0 && size.height > 0;
    if (!this.visible) return;
    const width = size.width / zoom();
    if (this.resizePending && Math.abs(width - this.lastRequestedWidth) <= 4) this.resizePending = null;
    else if (previous?.width > 0 && Math.abs(size.width - previous.width) / zoom() > 4 && this.sizeViewport === view && this.lastRequestedWidth !== null && this.lastRequestedWidth !== undefined && !this.resizePending && Math.abs(width - this.lastRequestedWidth) > 4) this.manualWidthSpace = this.spaceId;
    this.sizeViewport = view;
    this.scheduleFit(cx, previous ? "background" : "user");
  }
  scheduleSync(cx) {
    if (this.syncPending) return;
    this.syncPending = true;
    cx.timer.after(0, cx => {
      this.syncPending = false;
      const loc = location(), revision = shared(REVISION);
      if (loc.key !== this.context || this.revision !== revision) { this.revision = revision; this.refresh(cx); }
      else this.syncTree(cx, loc);
    });
  }
  renderPanel(cx) {
    const loc = location();
    this.scheduleFit(cx);
    const activeRoot = rootOf(loc.cwd, this.rootInfo || this.workspace?.folders || [])?.path;
    if (loc.key !== this.context || this.revision !== shared(REVISION) || activeRoot !== this.activeRoot || this.treeSignature !== JSON.stringify([this.treeVersion, activeRoot, settings().dark])) this.scheduleSync(cx);
    const entry = workspaceOf(this.spaceId), t = palette(), roots = this.rootInfo || entry?.folders || [];
    const fileRoot = this.file ? rootOf(this.file, roots) : null;
    const add = Boolean(this.root || entry?.folders.length) && this.on === null && appWindow().platform !== "windows";
    const title = this.file ? fileRoot ? `${label(fileRoot)}/${relativePath(fileRoot.path, this.file)}` : relativePath(this.root, this.file) : entry?.name || (this.root ? label({ path: this.root }) : "");
    return v_flex().id("files-plus").size_full().min_h(0).overflow_hidden().bg(t.background).text_color(t.foreground).text_size(13)
      .on_size_change((size, cx) => this.panelResized(size, cx))
      .on_mouse_down("left", event => { if (event.bounds) this.panelBounds = event.bounds; })
      .on_mouse_up("left", () => { this.dragCandidate = null; })
      .on_click((_event, cx) => {
        const row = this.clickedRow; this.clickedRow = null;
        if (row) { if (row.kind === "file") this.openFile(row.path, row.root, cx); else this.toggle(row.path, cx); }
      })
      .on_mouse_move((event, cx) => dragMove(this, event, cx))
      .child(calibrationProbe(cx => { this.scheduleFit(cx); cx.notify(); }))
      .child(h_flex().h(42).flex_none().px(12).gap(8).items_center().bg(t.background).border_b(0.5).border_color(t.border)
        .when(Boolean(this.file), el => el.child(h_flex().id("files-back").size(24).items_center().justify_center().cursor_pointer().role("button").accessibility_label("Back to files").tooltip("Back to files").text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
          .on_click((_event, cx) => { this.show(null, cx); cx.notify(); }).child(svg("mods/files-plus/arrow-left.svg").size(14))))
        .child(div().font_semibold().child("Files"))
        .child(h_flex().id("add-folder").size(24).items_center().justify_center().text_color(t.muted).role("button").accessibility_label("Add folder").tooltip("Add folder…").disabled(!add)
          .when(add, el => el.cursor_pointer().hover(s => s.bg(t.hover).text_color(t.foreground))).on_click((_event, cx) => {
            if (!add) return;
            const root = entry?.folders[0]?.path || this.root;
            const target = this.target(root, "root", root);
            openOverlay({ mod: "files-plus", kind: "dialog", modal: true, ...dialogLayout("add-root", target), props: { role: "dialog", action: "add-root", target } });
            cx.stop_propagation();
          }).child(svg("mods/files-plus/plus.svg").size(14)))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.muted).child(title)))
      .when(Boolean(entry?.error), el => el.child(div().px(12).py(8).text_size(12).text_color(t.red).child(entry.error)))
      .when(!this.file, el => el.child(this.treeView))
      .when(Boolean(this.file), el => el.child(v_flex().id("files-preview").flex_1().min_h(0).opacity(this.previewEntered === false ? 0 : 1).transition("opacity", { duration: 250, easing: "ease-out" })
        .child(this.code ? Editor.new(this.code).flex_1().min_h(0) : div().p(12).text_color(t.muted)
          .when(!this.fileError, el => el.loop("opacity", { from: 0.5, to: 1, period: 1200, easing: "ease-out" })).child(this.fileError || "Loading file…"))));
  }
  close() {
    this.context = null; this.generation = {}; this.pending = new Map(); this.previewRequest = null; this.openRequest = null; this.fitTimer = null;
    this.watches?.clear(); this.configWatch = null; this.code?.release(); this.treeView?.release(); for (const chunk of this.chunks || []) chunk.entity.release();
  }
}
