import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { joinPath, label, shortPath } from "./roots.js";

export const CHUNK_SIZE = 100;

export function visibleRows(state) {
  const out = [];
  const status = (key, name, depth = 0, error = false) => out.push({ key, id: key, kind: "status", name, depth, error });
  const walk = (prefix, root, depth) => {
    if (depth > 40) return;
    const list = state.entries.get(prefix);
    if (!list?.length) { status(`empty-${prefix}`, list ? "No files" : "Loading files…", depth); return; }
    for (const entry of list) {
      const path = joinPath(prefix, entry.name), open = state.folders.has(path);
      out.push({ key: path, id: `file-${path}`, path, root, depth, kind: entry.dir ? "dir" : "file", name: entry.name,
        mark: state.marks[path], open, selected: path === state.selectedFile, fresh: state.fresh?.has(path) || false });
      if (entry.dir && open) walk(path, root, depth + 1);
    }
  };
  if (state.workspace) for (const folder of state.rootInfo || state.workspace.folders) {
    const path = folder.path, open = state.folders.has(path), missing = folder.exists === false;
    out.push({ key: `root-${path}`, id: `root-${path}`, path, root: path, depth: 0, kind: "root", name: label(folder),
      detail: missing ? "Not found" : shortPath(path), open, missing, selected: path === state.activeRoot });
    if (open && !missing) walk(path, path, 1);
  }
  else if (state.root) walk(state.root, state.root, 0);
  else status("no-folder", "No folder");
  if (state.error) status("tree-error", state.error, 0, true);
  if (state.limited) status("tree-limit", "File list limited to 500 entries per folder and 5,000 total");
  return out;
}

export class RowChunk extends View {
  init(p) { this.update(p); }
  update(p) { this.data = p; }
  render() {
    const { rows, panel, t } = this.data;
    return v_flex().children(rows.map(row => {
      if (row.kind === "status") return div().id(row.id).pl(8 + row.depth * 18).py(6).text_size(12).text_color(row.error ? t.red : t.muted).child(row.name);
      const folder = row.kind !== "file";
      return h_flex().id(row.id).h(28).flex_none().pl(8 + row.depth * 18).pr(8).gap(7).items_center().rounded(4).cursor_pointer()
        .when(row.selected, el => el.bg(t.selected)).hover(s => s.bg(t.hover))
        .on_click((_event, cx) => { if (!row.missing) folder ? panel.toggle(row.path, cx) : panel.openFile(row.path, row.root, cx); })
        .on_mouse_down("right", (event, cx) => panel.menu(row.path, row.kind, row.root, event, cx))
        .child(folder ? svg(`mods/files-plus/chevron-${row.open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.muted) : div().w(12).flex_none())
        .child(svg(`mods/files-plus/${folder ? "folder" : "file"}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().when(!row.detail, el => el.flex_1().min_w(0).truncate()).when(row.kind === "root", el => el.font_medium()).child(row.name))
        .when(Boolean(row.detail), el => el.child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).child(row.detail)))
        .when(Boolean(row.mark), el => el.child(div().text_size(12).text_color(row.mark === "A" ? t.green : row.mark === "D" || row.mark === "U" ? t.red : t.amber).child(row.mark)));
    }));
  }
}

export class TreeView extends View {
  init(p) { this.update(p); }
  update(p) { this.data = p; }
  render() {
    const { chunks, panel } = this.data;
    return v_flex().id("files-tree").flex_1().min_h(0).overflow_y_scrollbar().p(6)
      .on_mouse_down("right", (event, cx) => { if (!panel.workspace && panel.root) panel.menu(panel.root, "dir", panel.root, event, cx); })
      .children(chunks);
  }
}
