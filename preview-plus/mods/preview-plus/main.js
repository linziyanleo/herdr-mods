import { View, div, image } from "gpui-kit";
import { v_flex, h_flex, TextView, Editor, EditorState, Input, InputState } from "gpui-base";
import { props, shared, spaces, panes, focused, run, readTextFile, watchFolder, settings, nextCommand, exec, window } from "herdr";
import { target, dirname, basename, extension, kind, resolveLink, imageSize, normalize } from "./paths.js";
import { appearance, sourceStyle } from "./appearance.js";
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
  const title = { "←": "Back", "−": "Zoom out", "+": "Zoom in", "100%": "Actual size" }[label] || label;
  return div().id(id).h(28).px(8).flex_none().flex().items_center().justify_center().rounded(6).text_size(12)
    .role("button").accessibility_label(title).disabled(!enabled).cursor_default()
    .text_color(enabled ? selected ? colors.foreground : colors.muted : colors.dim)
    .when(title !== label, el => el.tooltip(title))
    .when(selected, el => el.bg(colors.selected).font_medium())
    .when(enabled, el => el
      .hover(s => s.bg(selected ? colors.selected : colors.hover).text_color(colors.foreground))
      .active(s => s.bg(colors.selected).text_color(colors.foreground))
      .on_mouse_down("left", (_event, cx) => cx.stop_propagation())
      .on_click((_event, cx) => { cx.stop_propagation(); action(cx); })).child(label);
}

export default class PreviewPlus extends View {
  init(_props, cx) {
    this.history = []; this.watchers = new Map(); this.watchedFiles = new Set();
    this.viewport = { width: 400, height: 500 }; this.zoom = null; this.page = 1; this.total = 0;
    this.pan = { x: 0, y: 0 };
    this.zoomInput = InputState.new({ value: "" });
    this.zoomInput.on("focus", () => { this.zoomEditing = true; });
    this.zoomInput.on("change", (_event, cx) => { if (this.zoomEditing) { this.zoomDirty = true; cx.notify(); } });
    this.zoomInput.on("submit", (_event, cx) => this.applyZoomInput(cx));
    this.zoomInput.on("blur", (_event, cx) => { this.zoomEditing = false; this.applyZoomInput(cx); });
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

  releaseEditor() { this.code?.release(); this.code = null; this.codeStyle = null; }

  updateEditor() {
    const style = sourceStyle(), ext = extension(this.selected.file);
    this.releaseEditor();
    this.code = EditorState.new({ language: LANGUAGE[ext] || ext, readonly: true, value: this.text, ...style });
    this.codeStyle = JSON.stringify(style);
  }

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
    this.zoomDirty = false; this.zoomEditing = false;
    this.pan = { x: 0, y: 0 }; this.drag = null;
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
          this.updateEditor();
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
    return this.mediaSize(null).width * (settings().zoom || 1) / this.media.width;
  }

  mediaSize(zoom = this.zoom) {
    const appZoom = settings().zoom || 1;
    return imageSize(this.media.width / appZoom, this.media.height / appZoom, this.viewport, zoom);
  }

  zoomLabel() { return this.media ? `${Number(((this.zoom ?? this.fitScale()) * 100).toFixed(2))}%` : ""; }

  applyZoomInput(cx) {
    if (this.media && this.zoomDirty) {
      const text = this.zoomInput.value().trim().replace(/%$/, "").trim();
      if (/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text) && Number.isFinite(Number(text))) this.setZoom(Number(text) / 100, cx);
    }
    this.zoomDirty = false;
    this.zoomInput.set_value(this.zoomLabel());
    cx.notify();
  }

  setZoom(value, cx) {
    if (value !== null && !Number.isFinite(value)) return;
    this.zoom = value === null ? null : Math.min(8, Math.max(0.05, value));
    if (value === null) this.pan = { x: 0, y: 0 };
    this.clampPan();
    this.zoomDirty = false; this.zoomInput.set_value(this.zoomLabel()); cx.notify();
  }

  scrollZoom(event, cx) {
    if (!this.media || this.loading) return;
    if (event.modifiers?.shift) {
      const appZoom = settings().zoom || 1;
      this.pan.x += event.delta.x / appZoom; this.pan.y += event.delta.y / appZoom;
      this.clampPan(); cx.stop_propagation(); cx.notify(); return;
    }
    const delta = event.delta_lines ? event.delta_lines.y * 40 : event.delta.y;
    if (!Number.isFinite(delta) || delta === 0) return;
    cx.stop_propagation();
    this.setZoom((this.zoom ?? this.fitScale()) * Math.exp(Math.max(-1, Math.min(1, delta * 0.005))), cx);
  }

  clampPan() {
    if (!this.media) return;
    const size = this.mediaSize();
    for (const [axis, dimension] of [["x", "width"], ["y", "height"]]) {
      const limit = Math.max(0, (size[dimension] - this.viewport[dimension] + 32) / 2);
      this.pan[axis] = Math.max(-limit, Math.min(limit, this.pan[axis]));
    }
  }

  dragImage(event, cx) {
    if (!this.drag) return;
    const appZoom = settings().zoom || 1;
    this.pan.x += (event.position.x - this.drag.x) / appZoom;
    this.pan.y += (event.position.y - this.drag.y) / appZoom;
    this.drag = event.position; this.clampPan(); cx.stop_propagation(); cx.notify();
  }

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
    if (!this.zoomEditing && !this.zoomRefreshPending && this.zoomInput.value() !== this.zoomLabel()) {
      this.zoomRefreshPending = true;
      cx.timer.after(0, cx => {
        this.zoomRefreshPending = false;
        if (!this.closed && !this.zoomEditing) { this.zoomInput.set_value(this.zoomLabel()); cx.notify(); }
      });
    }
    if (this.code && this.codeStyle !== JSON.stringify(sourceStyle())) {
      const previous = this.code;
      cx.spawn(async cx => {
        if (this.closed || this.code !== previous) return;
        this.updateEditor(); cx.notify();
      });
    }
    const { colors, font } = appearance(), file = this.selected?.file, type = file ? kind(file) : null, media = type === "image" || type === "pdf";
    const canBack = this.history.length > 0 || this.owner.mode !== "pane";
    return v_flex().id("preview-plus").size_full().min_w(0).min_h(0).rounded(10).overflow_hidden().bg(colors.background).border_1().border_color(colors.border).text_color(colors.foreground).font_family(font).text_size(13)
      .child(h_flex().h(42).flex_none().px(10).gap(4).items_center().border_b_1().border_color(colors.border)
        .when(Boolean(file), el => el.child(button("preview-back", "←", colors, cx => this.back(cx), canBack)))
        .child(div().flex_1().min_w(0).px(4).font_semibold().truncate().child(file ? basename(file) : "Files"))
        .when(type === "markdown", el => el
          .child(button("preview-formatted", "Preview", colors, cx => { this.source = false; cx.notify(); }, true, !this.source))
          .child(button("preview-source", "Source", colors, cx => { this.source = true; cx.notify(); }, true, this.source)))
        .when(Boolean(file), el => el.child(button("preview-open", "Open", colors, cx => this.open(cx), !this.selected.on)))
        .when(!file, el => el.child(button("preview-refresh", "Refresh", colors, cx => this.reload(cx), Boolean(this.tree) && !this.tree.loading))))
      .when(Boolean(file || this.owner.cwd), el => el.child(div().h(28).flex_none().px(16).flex().items_center().text_size(12).text_color(colors.muted).truncate().child(file ? dirname(file) : this.owner.cwd)))
      .when(media, el => el.child(h_flex().flex_none().min_h(36).px(8).gap(2).flex_wrap().items_center().border_b_1().border_color(colors.border)
        .child(button("preview-fit", "Fit", colors, cx => this.setZoom(null, cx), Boolean(this.media), this.zoom === null))
        .child(button("preview-zoom-out", "−", colors, cx => this.setZoom((this.zoom ?? this.fitScale()) / 1.25, cx), Boolean(this.media) && (this.zoom ?? this.fitScale()) > 0.05))
        .child(h_flex().w(76).h(28).flex_none().items_center().justify_center()
          .border(0.5).border_color(colors.border).rounded(6).text_color(colors.foreground)
          .child(Input.new(this.zoomInput).id("preview-zoom-percent")
            .w(Math.min(70, Math.max(24, this.zoomInput.value().length * 7.2 + 2))).h(24).px(0)
            .font_family("Geist Mono").text_size(12).disabled(!this.media).accessibility_label("Zoom percentage (5–800%)")))
        .child(button("preview-zoom-in", "+", colors, cx => this.setZoom((this.zoom ?? this.fitScale()) * 1.25, cx), Boolean(this.media) && (this.zoom ?? this.fitScale()) < 8))
        .child(div().flex_1())
        .when(type === "pdf", el => el
          .child(button("preview-previous", "Previous", colors, cx => this.turnPage(-1, cx), !this.loading && this.total > 0 && this.page > 1))
          .child(div().px(6).text_size(12).text_color(colors.muted).child(`${this.page} / ${this.total || "…"}`))
          .child(button("preview-next", "Next", colors, cx => this.turnPage(1, cx), !this.loading && this.page < this.total)))))
      .when(Boolean(this.actionError), el => el.child(div().px(16).py(8).text_size(12).text_color(colors.ansi1).child(this.actionError)))
      .when(Boolean(this.imageWarning && !this.source), el => el.child(div().px(16).py(8).text_size(12).text_color(colors.muted).child(this.selected?.on ? "Inline images are only available for local files." : "Some inline images could not be loaded.")))
      .when(!file && Boolean(this.tree), el => el.child(this.tree.render(colors, (value, cx) => this.show(value, cx))))
      .when(!file && !this.tree, el => el.child(div().p(16).text_size(12).text_color(colors.muted).child(this.owner.mode === "pane" ? "Pass an absolute file path to Preview Plus." : "Select a file in Files Plus.")))
      .when(Boolean(file), el => el.child(this.body(type, colors)));
  }

  body(type, colors) {
    if (this.error || this.loading) return div().flex_1().p(16).text_size(12).text_color(colors.muted).child(this.error || "Loading preview…");
    if (this.media) {
      const size = this.mediaSize();
      const x = (this.viewport.width - size.width) / 2 + this.pan.x;
      const y = (this.viewport.height - size.height) / 2 + this.pan.y;
      return div().id("preview-media").relative().flex_1().min_h(0).min_w(0).overflow_hidden()
        .when(Boolean(this.drag), el => el.cursor_grabbing())
        .when(!this.drag, el => el.cursor_grab())
        .on_mouse_down("left", (event, cx) => { this.drag = event.position; cx.stop_propagation(); cx.notify(); })
        .on_mouse_move((event, cx) => this.dragImage(event, cx))
        .on_mouse_up("left", (_event, cx) => { this.drag = null; cx.notify(); })
        .on_hover((hovered, cx) => { if (!hovered && this.drag) { this.drag = null; cx.notify(); } })
        .on_scroll_wheel((event, cx) => this.scrollZoom(event, cx))
        .on_size_change((size, cx) => this.measure(size, cx))
        .child(image(this.media.path).absolute().left(x).top(y).w(size.width).h(size.height));
    }
    if (type === "markdown" && !this.source) return v_flex().id("preview-markdown").flex_1().min_h(0).overflow_y_scrollbar().p(16).gap(12)
      .on_size_change((size, cx) => this.measure(size, cx))
      .children((this.markdownBlocks || [{ text: this.text || "" }]).map((block, index) => {
        if (!block.media) return TextView.markdown(`preview-markdown-${this.selected.file}-${index}`, block.text)
          .selectable(true).scrollable(false).w_full().flex_none().text_size(13).text_color(colors.foreground).on_link_click((url, cx) => this.follow(url, cx));
        const width = Math.min(block.media.width, Math.max(1, this.viewport.width - 32));
        return div().id(`preview-markdown-image-${index}`).w(width).h(width * block.media.height / block.media.width).flex_none().cursor_default()
          .on_click((_event, cx) => this.follow(block.href, cx)).child(image(block.media.path).size_full());
      }));
    return this.code ? Editor.new(this.code).flex_1().min_h(0) : div().flex_1();
  }

  measure(size, cx) {
    // Measurements are window points; builder dimensions also receive Herdr's zoom.
    const zoom = settings().zoom || 1, viewport = { width: size.width / zoom, height: size.height / zoom };
    if (Math.abs(this.viewport.width - viewport.width) > 0.5 || Math.abs(this.viewport.height - viewport.height) > 0.5) { this.viewport = viewport; this.clampPan(); cx.notify(); }
  }

  close() {
    this.closed = true; this.request = null; this.watchers.clear(); this.releaseEditor(); this.zoomInput.release();
  }
}
