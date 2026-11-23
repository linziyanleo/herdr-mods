import { div, svg } from "gpui-kit";
import { h_flex, v_flex, Input, InputState, v_virtual_list, VirtualListScrollHandle, Scrollbar } from "gpui-base";
import { basename, joinPath, label, shortPath } from "./roots.js";

export const SEARCH_LIMIT = 200;
export const SEARCH_SCAN_LIMIT = 10000;
export const SEARCH_FOLDER_LIMIT = 256;
const fold = text => text.normalize("NFC").toLowerCase();

function initials(stem) {
  const words = stem.replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, "$1 $2").replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1 $2")
    .match(/[\p{L}\p{N}]+/gu) || [];
  return words.map(word => String.fromCodePoint(word.codePointAt(0)).toLowerCase()).join("");
}

function matchScore(name, parent, query, terms, fuzzy) {
  const normalized = name.normalize("NFC"), filename = normalized.toLowerCase(), dot = normalized.lastIndexOf(".");
  const originalStem = dot > 0 ? normalized.slice(0, dot) : normalized;
  const stem = dot > 0 ? originalStem.toLowerCase() : filename;
  if (filename === query) return [0];
  if (stem === query) return [1];
  if (filename.startsWith(query)) return [2];
  if (terms.every(term => filename.includes(term))) return [3];
  const relative = parent ? `${parent}/${filename}` : filename;
  if (parent && terms.every(term => relative.includes(term))) return [4];
  if (!fuzzy) return null;

  // Keep fuzzy matches in the stem so letters in the extension cannot complete a name.
  let end = 0;
  for (const char of fuzzy) {
    const index = stem.indexOf(char, end);
    if (index < 0) return null;
    end = index + char.length;
  }
  const heads = initials(originalStem);
  if (heads.startsWith(query)) return [heads === query ? 5 : 6];
  let start = end;
  for (let i = fuzzy.length - 1; i >= 0; i--) start = stem.lastIndexOf(fuzzy[i], start - fuzzy[i].length);
  return [7, end - start - query.length, start];
}

function compareMatches(a, b) {
  for (let i = 0; i < a.score.length; i++) {
    const difference = a.score[i] - b.score[i];
    if (difference) return difference;
  }
  return a.depth - b.depth || a.result.relative.localeCompare(b.result.relative);
}

// Use the tree's listing policy, but never its expanded-only cache or entry caps.
export async function searchFiles(roots, on, query, list, current = () => true) {
  query = fold(query.trim());
  const terms = query.split(/\s+/), fuzzy = /^[\p{L}\p{N}]{2,}$/u.test(query) ? [...query] : null;
  const matches = [], errors = [];
  let failures = 0, scanLimited = false, scanned = 0, next = 0;
  const queue = query ? roots.map(root => ({ root: root.path, path: root.path, relative: "", depth: 0 })) : [];
  scan: while (next < queue.length && next < SEARCH_FOLDER_LIMIT && scanned < SEARCH_SCAN_LIMIT && current()) {
    const batch = queue.slice(next, Math.min(next + 4, SEARCH_FOLDER_LIMIT));
    next += batch.length;
    // The existing directory helper returns at most the given limit plus one.
    const remaining = SEARCH_SCAN_LIMIT - scanned;
    const listings = await Promise.all(batch.map(async folder => {
      try { return { folder, entries: await list(folder.path, on, remaining) }; }
      catch (error) { return { folder, error: error.message || String(error) }; }
    }));
    if (!current()) return null;
    for (const { folder, entries, error } of listings) {
      if (error !== undefined) {
        failures++;
        if (errors.length < 3) errors.push(`${folder.path}: ${error}`);
        continue;
      }
      const { root, depth } = folder, parent = fold(folder.relative), children = [];
      for (const entry of entries) {
        if (scanned === SEARCH_SCAN_LIMIT) { scanLimited = true; break scan; }
        scanned++;
        const relative = folder.relative ? `${folder.relative}/${entry.name}` : entry.name;
        if (entry.dir) {
          children.push({ root, relative, path: joinPath(folder.path, entry.name), depth: depth + 1 });
          continue;
        }
        const score = matchScore(entry.name, parent, query, terms, fuzzy);
        if (score) {
          const path = joinPath(folder.path, entry.name);
          matches.push({ score, depth, result: { key: JSON.stringify([on, root, path]), path, root, on, relative } });
        }
      }
      queue.push(...children.sort((a, b) => a.relative.localeCompare(b.relative)));
    }
  }
  if (!current()) return null;
  return {
    results: matches.sort(compareMatches).slice(0, SEARCH_LIMIT).map(match => match.result), errors, failures,
    truncated: matches.length > SEARCH_LIMIT, scanLimited: scanLimited || next < queue.length
  };
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
    this.input.on("submit", (_event, cx) => this.open(this.results[this.at]?.key, cx, true));
  }
  get active() { return Boolean(this.query.trim()); }
  setQuery(query, cx) {
    if (query === this.query) return;
    this.query = query;
    this.panel.syncWatches(cx);
    if (this.input.value() !== query) this.input.set_value(query);
    this.refresh(cx, true);
  }
  refresh(cx, force = false) {
    // A safety poll must not restart a slow traversal before it can finish.
    if (!force && this.busy && this.context === this.panel.context) return;
    const request = this.request = {}, panel = this.panel, context = panel.context;
    this.context = context; this.results = []; this.errors = []; this.failures = 0; this.truncated = false; this.scanLimited = false; this.at = 0;
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
  currentResult(result) {
    return result && !this.busy && result.on === this.panel.on && this.panel.current(this.context) ? result : null;
  }
  open(key, cx, temporary = false) {
    const result = this.currentResult(this.results.find(result => result.key === key));
    if (!result) return;
    this.at = this.results.indexOf(result);
    this.panel.openFile(result.path, result.root, cx, { temporary });
    cx.notify();
  }
  key(event, cx) {
    if (event.key === "escape") { this.clear(cx); this.panel.handle.focus(); cx.stop_propagation(); }
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
    const counts = new Map(), incomplete = [], details = [...this.errors];
    for (const result of results) {
      const name = fold(basename(result.path));
      counts.set(name, (counts.get(name) || 0) + 1);
    }
    if (this.scanLimited) {
      incomplete.push("scan limit reached");
      details.push(`Search examines up to ${SEARCH_SCAN_LIMIT} entries in ${SEARCH_FOLDER_LIMIT} folders.`);
    }
    if (this.failures) incomplete.push(`${this.failures} ${this.failures === 1 ? "folder unavailable" : "folders unavailable"}`);
    const status = this.busy ? "Searching…" : !this.roots?.length ? "No folder" : this.truncated ? `${SEARCH_LIMIT}+ results. Refine search.`
      : `${results.length} ${results.length === 1 ? "result" : "results"}`;
    return v_flex().id("files-search").flex_1().min_h(0).min_w(0)
      .child(div().id("files-search-status").px(14).py(6).text_size(12).text_color(t.muted).child(status))
      .when(incomplete.length > 0, el => el.child(div().id("files-search-error").px(14).py(6).text_size(12).text_color(t.ansi1).tooltip(details.join("\n"))
        .child(`Search incomplete: ${incomplete.join(", ")}`)))
      .when(!this.busy && !results.length && this.roots?.length > 0 && !incomplete.length, el => el.child(div().id("files-search-empty").px(14).py(6).text_size(13).text_color(t.muted).child("No matching files")))
      .when(results.length > 0, el => el.child(v_flex().relative().flex_1().min_h(0).min_w(0)
        .child(v_virtual_list("files-search-results", results.length, 48, index => results[index].key, range => results.slice(range.start, range.end).map(result => {
          const name = basename(result.path), showRoot = multiple || counts.get(fold(name)) > 1;
          return h_flex().id(`search-${result.key}`).h(48).w_full().min_w(0).px(14).gap(8).items_center().cursor_default().when(result.key === selected, row => row.bg(t.selected)).hover(s => s.bg(t.hover))
            .tooltip(`${result.on ? result.on + ":" : ""}${result.path}\nRoot: ${result.root}`)
            .child(svg("mods/files-plus/file.svg").size(14).flex_none().text_color(t.muted))
            .child(v_flex().flex_1().min_w(0)
              .child(div().truncate().text_size(13).child(name))
              .child(h_flex().min_w(0).gap(4).text_size(12).text_color(t.muted)
                .when(showRoot, line => line.child(div().min_w(0).max_w_1_2().truncate().text_ellipsis_middle().child(labels.get(result.root)))
                  .child(div().flex_none().child("/")))
                .child(div().flex_1().min_w(0).truncate().text_ellipsis_middle().child(result.relative))));
        }))
          .size_full().track_scroll(this.scroll).on_item_click((key, cx) => this.open(key, cx)))
        .child(Scrollbar.vertical("files-search-results").absolute().inset_0())));
  }
  close() { this.request = null; this.input.release(); this.scroll.release(); }
}
