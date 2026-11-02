import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { joinPath, label, shortPath } from "./roots.js";
import { textStyle } from "./appearance.js";

export const CHUNK_SIZE = 100;
export const FOLDER_MOTION = { duration: 250, easing: "ease-out" };

export function retainClosingRows(previous, rows, closingKeys) {
  if (!closingKeys.size) return rows;
  const keys = new Set(rows.map(row => row.key)), before = new Map();
  let pending = [];
  for (const row of previous) {
    if (keys.has(row.key)) {
      if (pending.length) before.set(row.key, pending);
      pending = [];
    } else if (closingKeys.has(row.key)) pending.push({ ...row, leaving: true });
  }
  return [...rows.flatMap(row => [...(before.get(row.key) || []), row]), ...pending];
}

export function visibleRows(state) {
  const out = [];
  const status = (key, name, depth = 0, error = false) => out.push({ key, id: key, kind: "status", name, depth, error, fresh: state.fresh?.has(key) || false });
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
    const { rows, panel, look } = this.data;
    const { colors: t, typography: type, spacing: s, radius: r } = look, height = type.md.line_height + s.xs;
    return textStyle(v_flex().w_full().min_w(0).text_color(t.foreground), type.md, type.sans).children(rows.map(row => {
      if (row.kind === "status") return textStyle(h_flex().id(row.id).h(row.fresh || row.leaving ? 0 : height).min_h(0).flex_none().overflow_hidden().items_center().pl(s.sm + row.depth * s.lg).text_color(row.error ? t.ansi1 : t.muted), type.sm, type.sans)
        .opacity(row.fresh || row.leaving ? 0 : 1).transition("height", FOLDER_MOTION).transition("opacity", FOLDER_MOTION)
        .child(div().truncate().tooltip(row.name).when(row.name === "Loading files…", el => el.loop("opacity", { from: 0.5, to: 1, period: 1200, easing: "ease-out" })).child(row.name));
      const folder = row.kind !== "file";
      return h_flex().id(row.id).w_full().min_w(0).h(row.fresh || row.leaving ? 0 : height).min_h(0).flex_none().overflow_hidden().pl(s.sm + row.depth * s.lg).pr(s.sm).gap(s.sm).items_center().rounded(r.sm).cursor_pointer().disabled(Boolean(row.leaving))
        .opacity(row.fresh || row.leaving ? 0 : 1).transition("height", FOLDER_MOTION).transition("opacity", FOLDER_MOTION)
        .when(row.selected, el => el.bg(t.selected)).hover(s => s.bg(t.hover))
        .on_mouse_down("left", (event) => { if (row.leaving) return; panel.suppressClick = false; panel.dragCandidate = { target: panel.target(row.path, row.kind, row.root), start: event.position }; })
        .on_click((_event, cx) => {
          if (row.leaving || panel.suppressClick) { panel.suppressClick = false; cx.stop_propagation(); return; }
          if (!row.missing) panel.clickedRow = row;
        })
        .on_mouse_down("right", (event, cx) => { if (row.leaving) cx.stop_propagation(); else panel.menu(row.path, row.kind, row.root, event, cx); })
        .child(folder ? svg(`mods/files-plus/chevron-${row.open ? "down" : "right"}.svg`).size(type.xs.size).flex_none().text_color(t.muted) : div().w(type.xs.size).flex_none())
        .child(svg(`mods/files-plus/${folder ? "folder" : "file"}.svg`).size(type.sm.size).flex_none().text_color(t.muted))
        .child(div().min_w(0).truncate().when(!row.detail, el => el.flex_1()).child(row.name))
        .when(Boolean(row.detail), el => el.child(textStyle(div().flex_1().min_w(0).truncate().text_color(t.muted), type.sm, type.sans).child(row.detail)))
        .when(Boolean(row.mark), el => el.child(textStyle(div().text_color(row.mark === "A" ? t.ansi2 : row.mark === "D" || row.mark === "U" ? t.ansi1 : t.ansi3), type.sm, type.sans).child(row.mark)));
    }));
  }
}

export class TreeView extends View {
  init(p) { this.update(p); }
  update(p) { this.data = p; }
  render() {
    const { chunks, panel, look } = this.data;
    return v_flex().id("files-tree").w_full().min_w(0).flex_1().min_h(0).overflow_y_scrollbar().p(look.spacing.sm)
      .on_mouse_down("right", (event, cx) => { if (!panel.workspace && panel.root) panel.menu(panel.root, "dir", panel.root, event, cx); })
      .children(chunks);
  }
}
