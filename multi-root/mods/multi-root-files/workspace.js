import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Editor } from "gpui-base";
import { spaces, focused, exec, watchFolder, theme, openOverlay } from "herdr";
import { workspaceOf, describeRoots, reloadWorkspace, dirname, resolvePath, label, shortPath, rootOf, relativePath, READ } from "./roots.js";

export function workspaceKey() {
  const id = spaces().find(s => s.active)?.id, entry = workspaceOf(id);
  return entry ? JSON.stringify({ space: id, folders: entry.folders.map(f => [f.path, f.name]) }) : null;
}

export class WorkspaceFiles extends View {
  initWorkspace() { this.rootWatches = new Map(); }

  watchRoot(path, cx) {
    if (this.rootWatches.has(path)) return;
    const token = {};
    this.rootWatches.set(path, token);
    cx.spawn(async cx => {
      try {
        while (this.rootWatches.get(path) === token) {
          await watchFolder(path);
          if (this.rootWatches.get(path) === token) this.refresh(cx);
        }
      } catch { if (this.rootWatches.get(path) === token) this.rootWatches.delete(path); }
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
          if (paths.some(path => resolvePath(dirname(file), path) === file)) {
            await reloadWorkspace(id).catch(() => null);
            this.refresh(cx);
            cx.notify();
          }
        }
      } catch { if (this.configWatch === token) this.configWatch = null; }
    });
  }

  refreshWorkspace(cx) {
    const id = spaces().find(s => s.active)?.id, entry = workspaceOf(id);
    this.workspace = entry;
    if (!entry) { this.rootWatches.clear(); this.configWatch = null; return false; }
    const context = workspaceKey();
    if (context !== this.context) {
      this.context = context; this.spaceId = id; this.root = null; this.on = null;
      this.entries = new Map(); this.folders = new Set(entry.folders.map(f => f.path)); this.pending = new Set();
      this.marks = {}; this.rootInfo = null; this.show(null); this.watched = null; this.error = null;
      this.rootWatches.clear();
    }
    this.watchConfig(id, entry.file, cx);
    this.loading = true; this.limited = false;
    cx.spawn(async cx => {
      try {
        const roots = this.rootInfo && this.rootInfo.every(f => f.exists) ? this.rootInfo : await describeRoots(entry.folders);
        if (workspaceKey() !== context) return;
        this.rootInfo = roots;
        for (const folder of roots) if (folder.exists) this.watchRoot(folder.path, cx);
        for (const path of this.folders) {
          const folder = rootOf(path, roots);
          if (folder?.exists) await this.loadFolder(path, context);
        }
        const marks = {};
        for (const top of new Set(roots.map(f => f.top).filter(Boolean))) {
          const result = await exec("git", [...READ, "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=normal"], { cwd: top });
          if (result.code !== 0) continue;
          for (const item of result.stdout.split("\0").filter(Boolean).slice(0, 5000)) {
            const xy = item.slice(0, 2), absolute = `${top}/${item.slice(3)}`;
            const mark = xy === "??" || xy.includes("A") ? "A" : xy.includes("U") ? "U" : xy.includes("D") ? "D" : "M";
            for (const folder of roots) if (folder.physical && (absolute === folder.physical || absolute.startsWith(folder.physical + "/")))
              marks[folder.path + absolute.slice(folder.physical.length)] = mark;
          }
        }
        if (workspaceKey() === context) { this.marks = marks; this.error = null; }
      } catch (error) { if (workspaceKey() === context) this.error = String(error); }
      finally { this.loading = false; cx.notify(); }
    });
    return true;
  }

  renderWorkspace() {
    const t = theme(), entry = workspaceOf(this.spaceId), roots = this.context === workspaceKey() && this.rootInfo ? this.rootInfo : entry.folders;
    const active = rootOf(focused()?.cwd, roots), fileRoot = this.file ? rootOf(this.file, roots) : null;
    return v_flex().id("files").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .when(Boolean(this.file), el => el.child(div().id("files-back").w(20).cursor_pointer().text_color(t.muted).on_click((_e, cx) => { this.show(null); cx.notify(); }).child("←")))
        .child(div().font_semibold().child("Files"))
        .child(div().id("add-folder").w(20).cursor_pointer().text_color(t.muted).on_click(() => openOverlay({ mod: "multi-root", kind: "dialog", width: 460, height: 240, props: { role: "open", action: "add", space: this.spaceId } })).child("+"))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim).child(fileRoot ? `${label(fileRoot)}/${relativePath(fileRoot.path, this.file)}` : entry.name)))
      .when(Boolean(entry.error), el => el.child(div().px(12).py(8).text_size(12).text_color(t.ansi1).child(entry.error)))
      .when(!this.file, el => el.child(v_flex().id("files-tree").flex_1().min_h(0).overflow_y_scrollbar().p(6)
        .children(roots.map(folder => {
          const open = this.folders.has(folder.path), missing = folder.exists === false;
          return v_flex().child(h_flex().id(`root-${folder.path}`).h(30).flex_none().px(8).gap(7).items_center().rounded(7)
            .when(active?.path === folder.path, el => el.bg(t.selected)).hover(el => el.bg(t.hover)).cursor_pointer()
            .on_click((_e, cx) => { if (!missing) this.toggle(folder.path, cx); })
            .on_mouse_down("right", (event, cx) => {
              cx.stop_propagation();
              openOverlay({ mod: "multi-root", kind: "popup", width: 280, height: 84, at: event.position, props: { role: "root-menu", space: this.spaceId, root: folder.path } });
            })
            .child(svg(`mods/multi-root-files/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim))
            .child(svg("mods/multi-root-files/folder.svg").size(14).flex_none().text_color(t.muted))
            .child(div().text_color(missing ? t.dim : t.foreground).child(label(folder)))
            .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.dim).child(missing ? "Not found" : shortPath(folder.path))))
            .when(open && !missing, el => el.children(this.rows(folder.path, 1, [], t))
              .when(!this.entries.get(folder.path)?.length, item => item.child(div().pl(44).py(6).text_size(12).text_color(t.dim)
                .child(this.entries.has(folder.path) ? "No files" : "Loading files…"))));
        }))
        .when(Boolean(this.error) || !roots.length || !this.rootInfo, el => el.child(div().p(8).text_size(12).text_color(t.dim).child(this.error || (this.loading ? "Loading files…" : "No folder"))))
        .when(this.limited, el => el.child(div().p(8).text_size(12).text_color(t.dim).child("File list limited to 500 entries per folder and 5,000 total")))))
      .when(Boolean(this.file), el => el.child(this.code ? Editor.new(this.code).flex_1().min_h(0) : div().p(12).text_color(t.dim).child(this.fileError || "Loading file…")));
  }
}
