import { div, svg } from "gpui-kit";
import { h_flex, v_flex, Input, InputState, v_virtual_list, VirtualListScrollHandle, Scrollbar } from "gpui-base";
import { basename, joinPath, label, shortPath } from "./roots.js";

export const SEARCH_LIMIT = 200;
export const pathTerms = query => query.trim().toLowerCase().split(/\s+/).filter(Boolean);

// Use the tree's listing policy, but never its expanded-only cache or entry caps.
export async function searchFiles(roots, on, query, list, current = () => true) {
  const terms = pathTerms(query), results = [], errors = [];
  let failures = 0, truncated = false;
  if (!terms.length) return { results, errors, failures, truncated };
  const queue = roots.map(root => ({ root: root.path, path: root.path, relative: "" }));
  while (queue.length && current() && !truncated) {
    const batch = queue.splice(0, 4);
    const listings = await Promise.all(batch.map(async folder => {
      try { return { folder, entries: await list(folder.path, on, null) }; }
      catch (error) { return { folder, error: error.message || String(error) }; }
    }));
    if (!current()) return null;
    for (const { folder, entries, error } of listings) {
      if (error !== undefined) {
        failures++;
        if (errors.length < 3) errors.push(`${folder.path}: ${error}`);
        continue;
      }
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        const path = joinPath(folder.path, entry.name), relative = folder.relative ? `${folder.relative}/${entry.name}` : entry.name;
        if (entry.dir) queue.push({ root: folder.root, path, relative });
        else if (terms.every(term => relative.toLowerCase().includes(term))) {
          if (results.length === SEARCH_LIMIT) { truncated = true; break; }
          results.push({ key: JSON.stringify([on, folder.root, path]), path, root: folder.root, on, relative });
        }
      }
      if (truncated) break;
    }
  }
  return current() ? { results, errors, failures, truncated } : null;
}

export function rootContexts(roots) {
  const names = roots.map(label);
  return new Map(roots.map((root, i) => [root.path, names.filter(name => name === names[i]).length > 1 ? shortPath(root.path) : names[i]]));
}

export class FileSearch {
  constructor(panel, list, cx) {
    this.panel = panel; this.list = list; this.query = ""; this.results = []; this.errors = []; this.failures = 0; this.at = 0;
    this.input = InputState.new({ placeholder: "Find files by path" });
    this.handle = cx.focus_handle();
    this.scroll = VirtualListScrollHandle.new();
    this.input.on("change", (_event, cx) => this.setQuery(this.input.value(), cx));
    this.input.on("submit", (_event, cx) => this.open(this.results[this.at]?.key, cx));
  }
  get active() { return pathTerms(this.query).length > 0; }
  setQuery(query, cx) {
    if (query === this.query) return;
    this.query = query;
    if (this.input.value() !== query) this.input.set_value(query);
    this.refresh(cx, true);
  }
  refresh(cx, force = false) {
    // A safety poll must not restart a slow traversal before it can finish.
    if (!force && this.busy && this.context === this.panel.context) return;
    const request = this.request = {}, panel = this.panel, context = panel.context;
    this.context = context; this.results = []; this.errors = []; this.failures = 0; this.truncated = false; this.at = 0;
    this.roots = (panel.workspace?.folders || (panel.root ? [{ path: panel.root }] : [])).map(root => ({ ...root }));
    this.on = panel.on; this.busy = this.active && this.roots.length > 0;
    cx.notify();
    if (!this.busy) return;
    const query = this.query, roots = this.roots, on = this.on;
    const current = () => this.request === request && panel.current(context);
    cx.timer.after(180, cx => {
      if (!current()) return;
      cx.spawn(async cx => {
        const result = await searchFiles(roots, on, query, this.list, current);
        if (!result || !current()) return;
        Object.assign(this, result); this.busy = false;
        this.scroll.scroll_to_item(0); cx.notify();
      });
    });
  }
  clear(cx) { this.setQuery("", cx); }
  open(key, cx) {
    const result = this.results.find(result => result.key === key);
    if (!result || this.busy || !this.panel.current(this.context) || result.on !== this.panel.on) return;
    this.at = this.results.indexOf(result);
    this.panel.openFile(result.path, result.root, cx);
    cx.notify();
  }
  key(event, cx) {
    if (event.key === "escape") { this.clear(cx); cx.stop_propagation(); }
    else if (this.active && ["up", "down"].includes(event.key)) {
      this.at = Math.max(0, Math.min(this.results.length - 1, this.at + (event.key === "down" ? 1 : -1)));
      if (this.results.length) this.scroll.scroll_to_item(this.at, "center");
      cx.stop_propagation(); cx.notify();
    }
  }
  renderInput(t) {
    return h_flex().id("files-search-bar").flex_none().min_w(0).px(8).py(6).gap(6).items_center()
      .track_focus(this.handle).on_key_down((event, cx) => this.key(event, cx))
      .child(Input.new(this.input).id("files-search-input").flex_1().min_w(0).h(30).px(8).text_size(13).text_color(t.foreground).bg(t.background).border(0.5).border_color(t.input).rounded(6).accessibility_label("Find files by path"))
      .when(Boolean(this.query), el => el.child(div().id("files-search-clear").px(6).h(30).flex().items_center().text_size(12).text_color(t.muted).cursor_default().rounded(6).role("button").accessibility_label("Clear file search").hover(s => s.bg(t.hover))
        .on_click((_event, cx) => { cx.stop_propagation(); this.clear(cx); this.input.focus(); }).child("Clear")));
  }
  renderResults(t) {
    const results = this.results, selected = results[this.at]?.key, labels = rootContexts(this.roots || []), multiple = labels.size > 1;
    const status = this.busy ? "Searching…" : !this.roots?.length ? "No folder" : this.truncated ? `${SEARCH_LIMIT}+ results. Refine search.`
      : `${results.length} ${results.length === 1 ? "result" : "results"}`;
    return v_flex().id("files-search").flex_1().min_h(0).min_w(0)
      .child(div().id("files-search-status").px(14).py(6).text_size(12).text_color(t.muted).child(status))
      .when(this.failures > 0, el => el.child(div().id("files-search-error").px(14).py(6).text_size(12).text_color(t.ansi1).tooltip(this.errors.join("\n"))
        .child(`Search incomplete: ${this.failures} ${this.failures === 1 ? "folder unavailable" : "folders unavailable"}`)))
      .when(!this.busy && !results.length && this.roots?.length > 0 && !this.failures, el => el.child(div().id("files-search-empty").px(14).py(6).text_size(13).text_color(t.muted).child("No matching files")))
      .when(results.length > 0, el => el.child(v_flex().relative().flex_1().min_h(0).min_w(0)
        .child(v_virtual_list("files-search-results", results.length, 48, index => results[index].key, range => results.slice(range.start, range.end).map(result =>
          h_flex().id(`search-${result.key}`).h(48).w_full().min_w(0).px(14).gap(8).items_center().cursor_default().when(result.key === selected, row => row.bg(t.selected)).hover(s => s.bg(t.hover))
            .tooltip(`${result.on ? result.on + ":" : ""}${result.path}\nRoot: ${result.root}`)
            .child(svg("mods/files-plus/file.svg").size(14).flex_none().text_color(t.muted))
            .child(v_flex().flex_1().min_w(0)
              .child(div().truncate().text_size(13).child(basename(result.path)))
              .child(div().truncate().text_size(12).text_color(t.muted).child(`${multiple ? labels.get(result.root) + " / " : ""}${result.relative}`)))))
          .size_full().track_scroll(this.scroll).on_item_click((key, cx) => this.open(key, cx)))
        .child(Scrollbar.vertical("files-search-results").absolute().inset_0())));
  }
  close() { this.request = null; this.input.release(); this.scroll.release(); }
}
