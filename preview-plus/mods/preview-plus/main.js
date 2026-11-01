import { View, div, image } from "gpui-kit";
import { v_flex, h_flex, TextView, Editor, EditorState } from "gpui-base";
import { props, shared, spaces, panes, focused, run, readTextFile, watchFolder, settings, nextCommand, exec, window } from "herdr";
import { target, dirname, basename, extension, kind, resolveLink, imageSize, normalize } from "./paths.js";
import { palette } from "./palette.js";
import { loadMedia, openFile } from "./media.js";
import { stageMarkdown } from "./markdown.js";
import { Tree } from "./tree.js";

const TEXT_LIMIT = 400000;
const LANGUAGE = { md: "markdown", ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html" };

function context() {
  const p = props() || {}, f = focused(), space = spaces().find(s => s.id === f?.space) || spaces().find(s => s.active);
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  if (p.file !== undefined) return { mode: "pane", spaceId: space?.id || null, target: target(p) };
  if (p.previewStack) return { mode: "paired", stack: p.previewStack, spaceId: space?.id || null, target: target(shared("preview-plus.target")?.[space?.id]) };
  const on = f?.pane === null && f?.terminal ? (f.terminal.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine || null;
  return { mode: "files", spaceId: space?.id || null, cwd: pane?.cwd || f?.cwd || space?.folder || null, on };
}
const contextKey = () => JSON.stringify(context());

function button(id, label, colors, action, enabled = true, selected = false) {
  return div().id(id).h(28).px(8).flex_none().flex().items_center().justify_center().text_size(12)
    .text_color(enabled ? selected ? colors.foreground : colors.muted : colors.border)
    .when(selected, el => el.bg(colors.selected))
    .when(enabled, el => el.cursor_pointer().hover(s => s.bg(colors.hover)).on_click((_event, cx) => action(cx))).child(label);
}

export default class PreviewPlus extends View {
  init(_props, cx) {
    this.history = []; this.watchers = new Map(); this.watchedFiles = new Set();
    this.viewport = { width: 400, height: 500 }; this.zoom = null; this.page = 1; this.total = 0;
    this.sync(cx);
    cx.spawn(async cx => {
      for (;;) {
        const command = await nextCommand();
        if (command === "back") this.back(cx);
        else if (command === "source") { this.source = true; cx.notify(); }
        else if (command === "preview") { this.source = false; cx.notify(); }
        else if (command === "refresh") this.reload(cx);
        else if (command === "fit") this.setZoom(null, cx);
        else if (command === "zoom-in") this.setZoom((this.zoom ?? this.fitScale()) * 1.25, cx);
        else if (command === "zoom-out") this.setZoom((this.zoom ?? this.fitScale()) / 1.25, cx);
        else if (command === "next") this.turnPage(1, cx);
        else if (command === "previous") this.turnPage(-1, cx);
      }
    });
    // Only remote directory listings need a bounded refresh timer; live app data does not.
    cx.timer.every(10000, cx => { if (this.tree?.location.on && !this.selected) this.tree.refresh(cx); });
  }

  sync(cx) {
    const next = context(), key = JSON.stringify(next);
    if (this.owner?.key === key) return;
    this.owner = { ...next, key }; this.request = null; this.releaseEditor();
    this.history = []; this.selected = null; this.media = null; this.text = null; this.error = null; this.actionError = null;
    this.watchTargets([], cx); this.tree = null;
    if (next.mode === "files") {
      const owner = this.owner;
      this.tree = new Tree(next, () => !this.closed && this.owner === owner && contextKey() === owner.key);
      this.tree.refresh(cx); this.tree.watch(cx);
    } else if (next.target) this.show(next.target, cx, false, false);
  }

  current(request) {
    return !this.closed && this.request === request && this.owner === request.owner && contextKey() === request.owner.key;
  }

  releaseEditor() { this.code?.release(); this.code = null; }

  show(value, cx, remember = false, notify = true) {
    const next = target(value);
    if (!next) return;
    if (remember && this.selected) this.history.push({ target: this.selected, source: this.source, zoom: this.zoom, page: this.page });
    this.selected = next; this.source = false; this.zoom = null; this.page = 1; this.total = 0;
    this.load(cx, notify);
  }

  load(cx, notify = true) {
    if (!this.selected) return;
    const selected = this.selected, type = kind(selected.file), request = { owner: this.owner, selected, page: this.page };
    this.request = request; this.releaseEditor(); this.text = null; this.markdownBlocks = null; this.media = null;
    this.error = null; this.actionError = null; this.imageWarning = false; this.loading = true; this.reloadPending = false;
    this.watchTargets(selected.on ? [] : [selected.file], cx);
    cx.spawn(async cx => {
      try {
        if (type === "image" || type === "pdf") {
          const media = await loadMedia(selected, request.page, type);
          if (!this.current(request)) return;
          this.media = media; this.page = media.page; this.total = media.pages;
        } else {
          const value = await readTextFile(selected.file, { on: selected.on });
          if (!this.current(request)) return;
          if (value === null) throw new Error("This file is no longer available.");
          if (value.includes("\0")) throw new Error("This binary file has no text preview.");
          this.truncated = value.length > TEXT_LIMIT;
          this.text = this.truncated ? value.slice(0, TEXT_LIMIT) + "\n\n… (file truncated)" : value;
          if (type === "markdown") {
            const staged = await stageMarkdown(this.text, selected);
            if (!this.current(request)) return;
            this.markdownBlocks = staged.blocks; this.imageWarning = staged.unavailable;
            this.watchTargets(selected.on ? [] : [selected.file, ...staged.files], cx);
          }
          if (!this.current(request)) return;
          const colors = palette(), ext = extension(selected.file);
          this.code = EditorState.new({ language: LANGUAGE[ext] || ext, readonly: true, value: this.text,
            font_family: settings().font_family, font_size: 12,
            syntax: { keyword: colors.purple, string: colors.green, comment: colors.muted, function: colors.blue, type: colors.amber, number: colors.red, constant: colors.blue } });
        }
      } catch (error) { if (this.current(request)) this.error = String(error.message || error); }
      finally {
        if (this.current(request)) {
          this.loading = false;
          if (this.reloadPending) this.load(cx);
          cx.notify();
        }
      }
    });
    if (notify) cx.notify();
  }

  reload(cx) {
    if (this.selected) {
      if (this.loading) this.reloadPending = true; else this.load(cx);
    } else this.tree?.refresh(cx);
  }

  watchTargets(files, cx) {
    this.watchedFiles = new Set(files.map(normalize));
    const directories = new Set(files.map(dirname));
    for (const dir of this.watchers.keys()) if (!directories.has(dir)) this.watchers.delete(dir);
    for (const dir of directories) {
      if (this.watchers.has(dir)) continue;
      const token = {}; this.watchers.set(dir, token);
      cx.spawn(async cx => {
        try {
          // Register first so saves during physical-path resolution remain queued.
          let pending = watchFolder(dir);
          const windows = window()?.platform === "windows";
          const physical = windows ? dir : (await exec("pwd", ["-P"], { cwd: dir })).stdout.trim() || dir;
          const pathKey = path => windows ? normalize(path).toLowerCase() : normalize(path);
          while (!this.closed && this.watchers.get(dir) === token) {
            const changed = await pending;
            if (this.closed || this.watchers.get(dir) !== token) return;
            // A directory event can represent an atomic save or a folder rename.
            if (changed.some(path => {
              const value = pathKey(path);
              return [...this.watchedFiles].some(file => {
                const canonical = pathKey(dirname(file) === dir ? `${physical}/${basename(file)}` : file), original = pathKey(file);
                return original === value || canonical === value || canonical.startsWith(value + "/");
              });
            })) this.reload(cx);
            pending = watchFolder(dir);
          }
        } catch { if (this.watchers.get(dir) === token) this.watchers.delete(dir); }
      });
    }
  }

  follow(href, cx) {
    if (!this.selected) return;
    try {
      const link = resolveLink(this.selected.file, href);
      if (link.url) cx.open_url(link.url);
      else if (link.file && link.file !== this.selected.file) this.show({ ...this.selected, file: link.file }, cx, true);
    } catch (error) { this.actionError = String(error.message || error); cx.notify(); }
  }

  back(cx) {
    if (this.history.length) {
      const previous = this.history.pop();
      this.selected = previous.target; this.source = previous.source; this.zoom = previous.zoom; this.page = previous.page; this.total = 0;
      this.load(cx);
    } else if (this.owner.mode === "paired") run("layout.select", { stack: this.owner.stack, child: "files-plus-tree" });
    else if (this.owner.mode === "files") {
      this.selected = null; this.request = null; this.releaseEditor(); this.media = null; this.error = null; this.actionError = null;
      this.watchTargets([], cx); this.tree?.refresh(cx); cx.notify();
    }
  }

  fitScale() {
    if (!this.media) return 1;
    return imageSize(this.media.width, this.media.height, this.viewport, null).width / this.media.width;
  }

  setZoom(value, cx) { this.zoom = value === null ? null : Math.min(8, Math.max(0.05, value)); cx.notify(); }

  turnPage(delta, cx) {
    if (kind(this.selected?.file || "") !== "pdf" || !this.total) return;
    const page = Math.min(this.total, Math.max(1, this.page + delta));
    if (page !== this.page) { this.page = page; this.load(cx); }
  }

  open(cx) {
    if (!this.selected) return;
    const selected = this.selected;
    cx.spawn(async cx => {
      try { await openFile(selected); }
      catch (error) { if (this.selected === selected) { this.actionError = String(error.message || error); cx.notify(); } }
    });
  }

  render(cx) {
    this.sync(cx);
    const colors = palette(), file = this.selected?.file, type = file ? kind(file) : null, media = type === "image" || type === "pdf";
    const canBack = this.history.length > 0 || this.owner.mode !== "pane";
    return v_flex().id("preview-plus").size_full().min_w(0).min_h(0).overflow_hidden().bg(colors.background).text_color(colors.foreground).text_size(13)
      .child(h_flex().h(44).flex_none().px(8).gap(4).items_center().border_b(0.5).border_color(colors.border)
        .when(Boolean(file), el => el.child(button("preview-back", "←", colors, cx => this.back(cx), canBack)))
        .child(div().flex_1().min_w(0).px(4).font_semibold().truncate().child(file ? basename(file) : "Files"))
        .when(type === "markdown", el => el
          .child(button("preview-formatted", "Preview", colors, cx => { this.source = false; cx.notify(); }, true, !this.source))
          .child(button("preview-source", "Source", colors, cx => { this.source = true; cx.notify(); }, true, this.source)))
        .when(Boolean(file), el => el.child(button("preview-open", "Open", colors, cx => this.open(cx), !this.selected.on)))
        .when(!file, el => el.child(button("preview-refresh", "Refresh", colors, cx => this.reload(cx)))))
      .when(Boolean(file || this.owner.cwd), el => el.child(div().h(28).flex_none().px(16).flex().items_center().text_size(12).text_color(colors.muted).truncate().child(file ? dirname(file) : this.owner.cwd)))
      .when(media, el => el.child(h_flex().flex_none().min_h(36).px(8).gap(2).flex_wrap().items_center().border_b(0.5).border_color(colors.border)
        .child(button("preview-fit", "Fit", colors, cx => this.setZoom(null, cx), true, this.zoom === null))
        .child(button("preview-zoom-out", "−", colors, cx => this.setZoom((this.zoom ?? this.fitScale()) / 1.25, cx), Boolean(this.media)))
        .child(button("preview-zoom-actual", "100%", colors, cx => this.setZoom(1, cx), true, this.zoom === 1))
        .child(button("preview-zoom-in", "+", colors, cx => this.setZoom((this.zoom ?? this.fitScale()) * 1.25, cx), Boolean(this.media)))
        .child(div().flex_1())
        .when(type === "pdf", el => el
          .child(button("preview-previous", "Previous", colors, cx => this.turnPage(-1, cx), this.total > 0 && this.page > 1))
          .child(div().px(6).text_size(12).text_color(colors.muted).child(`${this.page} / ${this.total || "…"}`))
          .child(button("preview-next", "Next", colors, cx => this.turnPage(1, cx), this.page < this.total)))))
      .when(Boolean(this.actionError), el => el.child(div().px(16).py(8).text_size(12).text_color(colors.red).child(this.actionError)))
      .when(Boolean(this.imageWarning && !this.source), el => el.child(div().px(16).py(8).text_size(12).text_color(colors.muted).child(this.selected?.on ? "Inline images are only available for local files." : "Some inline images could not be loaded.")))
      .when(!file && Boolean(this.tree), el => el.child(this.tree.render(colors, (value, cx) => this.show(value, cx))))
      .when(!file && !this.tree, el => el.child(div().p(16).text_size(12).text_color(colors.muted).child(this.owner.mode === "pane" ? "Pass an absolute file path to Preview Plus." : "Select a file in Files Plus.")))
      .when(Boolean(file), el => el.child(this.body(type, colors)));
  }

  body(type, colors) {
    if (this.error || this.loading) return div().flex_1().p(16).text_size(12).text_color(colors.muted).child(this.error || "Loading preview…");
    if (this.media) {
      const size = imageSize(this.media.width, this.media.height, this.viewport, this.zoom);
      return div().id("preview-media").flex_1().min_h(0).min_w(0).overflow_scrollbar()
        .on_size_change((size, cx) => this.measure(size, cx))
        .child(v_flex().min_w_full().min_h_full().w(size.width + 32).h(size.height + 32).p(16).items_center().justify_center()
          .child(image(this.media.path).w(size.width).h(size.height).flex_none()));
    }
    if (type === "markdown" && !this.source) return v_flex().id("preview-markdown").flex_1().min_h(0).overflow_y_scrollbar().p(16).gap(12)
      .on_size_change((size, cx) => this.measure(size, cx))
      .children((this.markdownBlocks || [{ text: this.text || "" }]).map((block, index) => {
        if (!block.media) return TextView.markdown(`preview-markdown-${this.selected.file}-${index}`, block.text)
          .selectable(true).scrollable(false).w_full().flex_none().text_size(13).text_color(colors.foreground).on_link_click((url, cx) => this.follow(url, cx));
        const width = Math.min(block.media.width, Math.max(1, this.viewport.width - 32));
        return image(block.media.path).id(`preview-markdown-image-${index}`).w(width).h(width * block.media.height / block.media.width).flex_none().cursor_pointer()
          .on_click((_event, cx) => this.follow(block.href, cx));
      }));
    return this.code ? Editor.new(this.code).flex_1().min_h(0) : div().flex_1();
  }

  measure(size, cx) {
    if (Math.abs(this.viewport.width - size.width) > 0.5 || Math.abs(this.viewport.height - size.height) > 0.5) { this.viewport = size; cx.notify(); }
  }

  close() {
    this.closed = true; this.request = null; this.watchers.clear(); this.releaseEditor();
  }
}
