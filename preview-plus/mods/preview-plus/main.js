import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState, Input, InputState } from "gpui-base";
import { props, shared, setShared, spaces, panes, terminals, focused, run, readTextFile, writeTextFile, watchFolder, checking, settings, nextCommand, exec, window } from "herdr";
import { target, dirname, basename, extension, kind, richText, resolveLink, imageSize, normalize } from "./paths.js";
import { appearance, sourceStyle } from "./appearance.js";
import { loadMedia, mediaSignature, openFile } from "./media.js";
import { stageMarkdown } from "./markdown.js";
import { markdownView } from "./markdown-view.js";
import { structuredPreview } from "./structured.js";
import { structuredView } from "./structured-view.js";
import { literalMatches, sourceRange, typedLocation } from "./source-location.js";
import { Tree } from "./tree.js";

const TEXT_LIMIT = 400000;
const TRUNCATION_NOTICE = "\n\n… (file truncated)";
const LANGUAGE = { md: "markdown", ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html" };

function context() {
  const p = props() || {}, f = focused(), space = spaces().find(s => s.id === f?.space) || spaces().find(s => s.active);
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  if (p.file !== undefined) return { mode: "pane", spaceId: p.space || null, target: target(p) };
  if (p.previewStack) {
    const incoming = shared("preview-plus.target")?.[space?.id];
    return { mode: "paired", stack: p.previewStack, spaceId: space?.id || null,
      target: target(shared("preview-plus.pinned")?.[space?.id] || incoming), selection: incoming?.selection };
  }
  const on = f?.pane === null && f?.terminal ? (f.terminal.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine || null;
  return { mode: "files", spaceId: space?.id || null, cwd: pane?.cwd || f?.cwd || space?.folder || null, on };
}
const contextKey = () => JSON.stringify(context());

const ICONS = {
  "preview-back": "back", "preview-open": "open",
  "preview-contents": "contents",
  "preview-go-to": "go-to", "preview-find": "find",
  "preview-wrap": "wrap", "preview-save": "save", "preview-discard": "undo", "preview-cancel-discard": "close", "preview-refresh": "refresh",
};

function button(id, label, colors, action, enabled = true, selected = false, icon = ICONS[id]) {
  const title = { "←": "Back", "−": "Zoom out", "+": "Zoom in", "100%": "Actual size", "↑": "Previous match", "↓": "Next match" }[label] || label;
  return div().id(id).h(icon ? 26 : 28).when(Boolean(icon), el => el.w(26)).when(!icon, el => el.px(8))
    .flex_none().flex().items_center().justify_center().rounded(6).text_size(12)
    .role("button").accessibility_label(title).disabled(!enabled).cursor_default()
    .text_color(enabled ? selected ? colors.foreground : colors.muted : colors.dim)
    .tooltip(title)
    .when(selected && enabled, el => el.bg(colors.selected).font_medium())
    .when(enabled, el => el
      .hover(s => s.bg(selected ? colors.selected : colors.hover).text_color(colors.foreground))
      .active(s => s.bg(colors.selected).text_color(colors.foreground))
      .on_mouse_down("left", (_event, cx) => cx.stop_propagation())
      .on_click((_event, cx) => { cx.stop_propagation(); action(cx); }))
    .child(icon ? svg(`mods/preview-plus/icons/${icon}.svg`).size(14) : label);
}

export default class PreviewPlus extends View {
  init(_props, cx) {
    this.documents = new Map();
    this.wrap = localStorage.getItem("preview-plus.wrap") === "true";
    try {
      for (const draft of JSON.parse(localStorage.getItem("preview-plus.drafts") || "[]")) {
        if (typeof draft.file === "string" && typeof draft.base === "string" && typeof draft.text === "string")
          this.documents.set(draft.file, { ...draft, saving: false });
      }
    } catch { this.draftError = "Saved drafts could not be read."; }
    this.history = []; this.watchers = new Map(); this.watchErrors = new Map(); this.watchedFiles = new Set();
    this.handle = cx.focus_handle();
    this.anchor = ""; this.contents = false; this.expanded = new Set([""]);
    this.viewport = { width: 400, height: 500 }; this.zoom = null; this.page = 1; this.total = 0;
    this.pan = { x: 0, y: 0 };
    this.zoomInput = InputState.new({ value: "" });
    this.zoomInput.on("focus", () => { this.zoomEditing = true; });
    this.zoomInput.on("change", (_event, cx) => { if (this.zoomEditing) { this.zoomDirty = true; cx.notify(); } });
    this.zoomInput.on("submit", (_event, cx) => this.applyZoomInput(cx));
    this.zoomInput.on("blur", (_event, cx) => { this.zoomEditing = false; this.applyZoomInput(cx); });
    this.goInput = InputState.new({ placeholder: "Line or line:column" });
    this.goInput.on("submit", (_event, cx) => this.goTo(cx));
    this.findInput = InputState.new({ placeholder: "Find literal text" });
    this.findInput.on("change", (_event, cx) => {
      if (this.navigation === "find" && this.sourceReady()) { this.updateFind(true); cx.notify(); }
    });
    this.findInput.on("submit", (event, cx) => this.stepFind(event.shift ? -1 : 1, cx));
    this.sync(cx);
    cx.spawn(async cx => {
      for (;;) {
        const command = await nextCommand();
        if (command === "focus") this.focusContent();
        else if (command === "pin") this.togglePin(cx);
        else if (command === "agent") this.focusAgent(cx);
        else if (command === "back") this.back(cx);
        else if (command === "source") this.setSource(true, cx);
        else if (command === "preview") this.setSource(false, cx);
        else if (command.startsWith("locate:")) this.locate(command.slice("locate:".length), cx);
        else if (command === "save") this.save(cx);
        else if (command === "wrap") this.toggleWrap(cx);
        else if (command === "refresh") this.reload(cx);
        else if (command === "fit") this.setZoom(null, cx);
        else if (command === "zoom-in") this.setZoom((this.zoom ?? this.fitScale()) * 1.25, cx);
        else if (command === "zoom-out") this.setZoom((this.zoom ?? this.fitScale()) / 1.25, cx);
        else if (command === "next") this.turnPage(1, cx);
        else if (command === "previous") this.turnPage(-1, cx);
      }
    });
    // Only remote directory listings need a bounded refresh timer; live app data does not.
    cx.timer.every(10000, cx => { if (this.selected?.on) this.poll(cx); else if (this.tree?.location.on && !this.selected) this.tree.refresh(cx); });
    cx.timer.every(60000, cx => { if (this.selected && !this.selected.on) this.poll(cx); else this.tree?.refresh(cx); });
  }

  sync(cx) {
    const next = context(), key = JSON.stringify(next);
    if (this.owner?.key === key) return;
    if (next.mode === "paired" && this.owner?.mode === "paired" && next.spaceId === this.owner.spaceId
      && next.target?.file === this.selected?.file && next.target?.on === this.selected?.on) {
      if (this.owner.selection !== next.selection) this.locationError = null;
      this.owner = { ...next, key };
      if (this.request) {
        this.request.owner = this.owner;
        if (this.request.position?.selection !== next.selection) this.request.position = null;
      }
      return;
    }
    this.owner = { ...next, key }; this.request = null; this.releaseEditor(); this.document = null;
    this.history = []; this.selected = null; this.media = null; this.text = null; this.error = null; this.actionError = null;
    this.navigation = null; this.locationError = null;
    this.watchTargets([], cx); this.tree?.close(); this.tree = null;
    if (checking()) return;
    if (next.mode === "files") {
      const owner = this.owner;
      this.tree = new Tree(next, () => !this.closed && this.owner === owner && contextKey() === owner.key);
      this.tree.refresh(cx); this.tree.watch(cx);
    } else if (next.target) {
      this.show(next.target, cx, false, false);
      if (next.mode === "pane" && props()?.location !== undefined && !localStorage.getItem("preview-plus.open-location"))
        this.queuePosition(props().location, { opening: true });
    }
  }

  current(request) {
    return !this.closed && this.request === request && this.owner === request.owner && contextKey() === request.owner.key;
  }

  syncRequest(request, cx) {
    if (this.closed || this.request !== request) return false;
    // A newer selection of the same file can reuse the read, but supersedes
    // any position queued for the previous selection.
    this.sync(cx);
    return this.request === request;
  }

  releaseEditor() { this.code?.release(); this.code = null; this.codeStyle = null; }

  focusContent() {
    if (this.code && (this.source || !richText(kind(this.selected.file)))) this.code.focus();
    else this.handle.focus();
  }

  updateEditor() {
    const style = sourceStyle(), ext = extension(this.selected.file);
    this.releaseEditor();
    const code = this.code = EditorState.new({ language: LANGUAGE[ext] || ext, readonly: !this.document, soft_wrap: this.wrap, value: this.text, ...style });
    code.on("change", (_event, cx) => this.editorChanged(code, cx));
    this.codeStyle = JSON.stringify(style);
    if (this.navigation === "find") this.updateFind(false);
  }

  editorChanged(code, cx) {
    if (this.code !== code || !this.document) return;
    this.text = this.document.text = code.value(); this.confirmDiscard = false;
    if (this.navigation === "find") this.updateFind(false);
    if (this.dirty()) this.pin();
    this.persistDrafts(); cx.notify();
  }

  dirty(doc = this.document) { return Boolean(doc && doc.text !== doc.base); }

  pinned() {
    const pinned = shared("preview-plus.pinned")?.[this.owner.spaceId];
    return Boolean(this.owner.mode === "paired" && pinned && pinned.file === this.selected?.file && pinned.on === this.selected?.on);
  }

  pin() {
    if (this.owner.mode === "paired" && this.selected && !this.pinned())
      setShared("preview-plus.pinned", { ...(shared("preview-plus.pinned") || {}), [this.owner.spaceId]: this.selected });
  }

  togglePin(cx) {
    if (!this.selected || this.owner.mode !== "paired") return;
    if (!this.pinned()) this.pin();
    else if (this.dirty() || this.document?.saving) this.actionError = "Save or confirm discard before unpinning this draft.";
    else {
      const incoming = shared("preview-plus.target") || {};
      setShared("preview-plus.target", { ...incoming, [this.owner.spaceId]: { ...incoming[this.owner.spaceId], ...this.selected } });
      const pins = { ...shared("preview-plus.pinned") }; delete pins[this.owner.spaceId];
      setShared("preview-plus.pinned", pins); this.actionError = null;
    }
    cx.notify();
  }

  focusAgent(cx) {
    const agent = props()?.agent || shared("preview-plus.target")?.[this.owner.spaceId]?.agent;
    const terminal = agent?.active?.terminal;
    const machine = terminal?.includes("/") ? terminal.split("/")[0] : null;
    if (!terminal || machine !== agent.on || !spaces().some(space => space.id === agent.space && space.machine === agent.on)
      || !terminals().some(terminal => terminal.address === agent.active.terminal && terminal.state === "live")) {
      this.actionError = "The captured agent terminal is no longer available."; cx.notify(); return;
    }
    run("pane.focus", { terminal: agent.active.terminal });
  }

  persistDrafts() {
    try {
      const drafts = [...this.documents.values()].filter(doc => this.dirty(doc) || doc.saving)
        .map(doc => ({ file: doc.file, base: doc.base, text: doc.text }));
      if (drafts.length) localStorage.setItem("preview-plus.drafts", JSON.stringify(drafts));
      else localStorage.removeItem("preview-plus.drafts");
      this.draftError = null;
    } catch { this.draftError = "Draft recovery is unavailable. Save before closing."; }
  }

  setSource(source, cx) {
    this.source = source;
    if (!source) {
      this.navigation = null;
      this.takePosition();
    }
    if (!source && this.selected && kind(this.selected.file) === "markdown") this.refreshMarkdown(cx);
    else if (!source && this.selected && richText(kind(this.selected.file))) this.refreshData();
    cx.notify();
  }

  sourceReady() {
    return this.code && !this.loading && !this.error && (this.source || !richText(kind(this.selected.file)));
  }

  sourceText() {
    const text = this.code.value();
    return this.truncated ? text.slice(0, -TRUNCATION_NOTICE.length) : text;
  }

  locate(encoded, cx) {
    let value;
    try { value = JSON.parse(decodeURIComponent(encoded)); } catch { return; }
    const focus = focused();
    if (!value || typeof value.space !== "string" || value.space !== focus?.space || typeof value.tab !== "string"
      || value.tab !== focus.tab || !(value.on === null || (typeof value.on === "string" && value.on))
      || value.location === undefined) return;
    this.sync(cx);
    const owner = this.owner, file = target(value);
    if (!file || value.space !== owner.spaceId || file.file !== this.selected?.file || file.on !== this.selected?.on) return;
    if (owner.mode === "pane") {
      if (typeof value.viewer !== "string" || !value.viewer || value.viewer !== props()?.viewer) return;
    } else if (owner.mode === "paired") {
      const incoming = target(shared("preview-plus.target")?.[owner.spaceId]);
      if (value.stack !== owner.stack || typeof value.selection !== "string" || !value.selection
        || value.selection !== owner.selection || incoming?.file !== file.file || incoming?.on !== file.on) return;
    } else return;
    this.queuePosition(value.location, { space: value.space, tab: value.tab, selection: value.selection });
    cx.notify();
  }

  queuePosition(value, scope) {
    this.takePosition();
    this.request.position = { value, ...scope };
    this.locationError = null;
    this.source = true;
  }

  applyPosition(request, position, cx) {
    if (!this.syncRequest(request, cx) || request.position !== position) return;
    const focus = focused();
    if (!position.opening && (focus?.space !== position.space || focus?.tab !== position.tab)) {
      this.takePosition(); return;
    }
    this.locationError = this.sourceReady() ? this.selectLocation(position.value) : "Source is unavailable for this file.";
    this.takePosition();
    cx.notify();
  }

  takePosition() {
    if (!this.request?.position) return;
    if (this.request.position.opening) localStorage.setItem("preview-plus.open-location", "true");
    this.request.position = null;
  }

  selectLocation(value) {
    const { range, error } = sourceRange(this.sourceText(), value, this.truncated);
    if (range) {
      this.code.set_selected_range(range);
      if (this.navigation === "find") this.updateFind(false);
    }
    return error;
  }

  toggleNavigation(mode, cx) {
    if (!this.sourceReady()) return;
    if (this.navigation === mode) { this.closeNavigation(cx); return; }
    this.navigation = mode;
    this.locationError = null;
    const input = mode === "find" ? this.findInput : this.goInput;
    input.set_value("");
    if (mode === "find") this.updateFind(false);
    cx.notify();
    cx.spawn(async () => { if (!this.closed && this.navigation === mode && this.sourceReady()) input.focus(); });
  }

  closeNavigation(cx) {
    this.navigation = null;
    this.locationError = null;
    this.focusContent(); cx.notify();
  }

  goTo(cx) {
    if (this.navigation !== "go" || !this.sourceReady()) return;
    this.locationError = this.selectLocation(typedLocation(this.goInput.value()));
    if (this.locationError) cx.notify();
    else this.closeNavigation(cx);
  }

  updateFind(selectFirst) {
    const { ranges, limited } = literalMatches(this.sourceText(), this.findInput.value());
    const selection = this.code.selected_range();
    const active = selectFirst ? (ranges.length ? 0 : -1)
      : ranges.findIndex(range => range.start === selection.start && range.end === selection.end);
    this.findResult = { ranges, limited, active };
    if (selectFirst && active !== -1) this.code.set_selected_range(ranges[active]);
  }

  stepFind(delta, cx) {
    if (this.navigation !== "find" || !this.sourceReady()) return;
    const result = this.findResult, count = result.ranges.length;
    if (!count) return;
    const selection = this.code.selected_range();
    const active = result.ranges.findIndex(range => range.start === selection.start && range.end === selection.end);
    result.active = active === -1 ? (delta > 0 ? 0 : count - 1) : (active + delta + count) % count;
    this.code.set_selected_range(result.ranges[result.active]); cx.notify();
  }

  refreshData() { this.dataPreview = structuredPreview(kind(this.selected.file), this.text || "", this.truncated); }

  toggleJson(path, cx) {
    if (this.expanded.has(path)) this.expanded.delete(path); else this.expanded.add(path);
    cx.notify();
  }

  acceptMarkdown(staged, look, cx) {
    this.markdownBlocks = staged.blocks; this.headings = staged.headings; this.imageWarning = staged.unavailable;
    this.markdownLook = JSON.stringify(look);
    if (this.anchor && !this.headings.some(h => h.slug === this.anchor)) {
      this.actionError = `Heading not found: #${this.anchor}`; this.anchor = "";
    }
    this.watchTargets(this.selected.on ? [] : [this.selected.file, ...staged.files], cx);
  }

  refreshMarkdown(cx) {
    const request = this.request, text = this.text, selected = this.selected;
    const look = appearance();
    const token = this.markdownRequest = {};
    this.markdownBusy = true;
    cx.spawn(async cx => {
      try {
        const staged = await stageMarkdown(text || "", selected, look);
        if (!this.current(request) || this.markdownRequest !== token || this.text !== text) return;
        if (JSON.stringify(appearance()) !== JSON.stringify(look)) { this.refreshMarkdown(cx); return; }
        this.acceptMarkdown(staged, look, cx);
        cx.notify();
      } catch (error) { if (this.current(request) && this.markdownRequest === token) { this.actionError = String(error.message || error); cx.notify(); } }
      finally { if (this.markdownRequest === token) { this.markdownBusy = false; cx.notify(); } }
    });
  }

  toggleWrap(cx) {
    if (!this.code || (richText(kind(this.selected.file)) && !this.source)) return;
    this.wrap = !this.wrap;
    localStorage.setItem("preview-plus.wrap", String(this.wrap));
    this.updateEditor(); cx.notify();
  }

  save(cx) {
    const doc = this.document;
    if (!doc || !this.dirty(doc) || doc.saving) return;
    const text = doc.text, expected = doc.base;
    doc.saving = true; doc.saveError = null; this.confirmDiscard = false; this.persistDrafts(); cx.notify();
    cx.spawn(async cx => {
      try {
        await writeTextFile(doc.file, text, expected);
        doc.base = text; doc.external = false;
      } catch (error) { doc.saveError = `Save failed: ${String(error.message || error)}. Your draft is retained.`; }
      finally {
        doc.saving = false; this.persistDrafts();
        if (!this.closed) cx.notify();
      }
    });
  }

  discard(cx) {
    if (!this.document || this.document.saving) return;
    if (!this.confirmDiscard) { this.confirmDiscard = true; cx.notify(); return; }
    this.documents.delete(this.document.file); this.document = null;
    this.persistDrafts(); this.load(cx);
  }

  keyDown(event, cx) {
    const saveKey = window()?.platform === "macos" ? "cmd-s" : "ctrl-s";
    if (event.keystroke === saveKey && this.document) { cx.stop_propagation(); this.save(cx); }
    else if (event.keystroke && event.keystroke !== event.key) return;
    else if (event.key === "escape" && this.navigation) { cx.stop_propagation(); this.closeNavigation(cx); }
    else if (event.key === "f6") { cx.stop_propagation(); this.back(cx); }
    else if (event.key === "f7") { cx.stop_propagation(); this.togglePin(cx); }
    else if (event.key === "f8") { cx.stop_propagation(); this.focusAgent(cx); }
  }

  remember() {
    this.history.push({ target: this.selected, source: this.source, zoom: this.zoom, page: this.page, anchor: this.anchor,
      contents: this.contents, expanded: [...this.expanded] });
  }

  show(value, cx, remember = false, notify = true, anchor = "") {
    const next = target(value);
    if (!next) return;
    this.tree?.close();
    if (remember && this.selected) this.remember();
    this.selected = next; this.source = false; this.zoom = null; this.page = 1; this.total = 0;
    this.navigation = null;
    this.anchor = anchor; this.contents = false; this.expanded = new Set([""]);
    this.load(cx, notify);
  }

  load(cx, notify = true) {
    if (!this.selected) return;
    const selected = this.selected, type = kind(selected.file), request = { owner: this.owner, selected, page: this.page };
    if (this.request?.selected === selected && this.request.position)
      request.position = { ...this.request.position, scheduled: false };
    this.request = request; this.releaseEditor(); this.document = null; this.confirmDiscard = false; this.text = null; this.markdownBlocks = null; this.media = null;
    this.markdownRequest = null; this.markdownBusy = false; this.markdownLook = null; this.headings = []; this.dataPreview = null;
    this.zoomDirty = false; this.zoomEditing = false;
    this.pan = { x: 0, y: 0 }; this.drag = null;
    this.error = null; this.actionError = null; this.locationError = null; this.imageWarning = false; this.loading = true; this.reloadPending = false;
    this.watchTargets(selected.on ? [] : [selected.file], cx);
    cx.spawn(async cx => {
      const active = () => this.syncRequest(request, cx);
      try {
        if (type === "image" || type === "pdf") {
          const media = await loadMedia(selected, request.page, type);
          if (!active()) return;
          this.media = media; this.page = media.page; this.total = media.pages;
        } else {
          const draft = !selected.on && this.documents.get(selected.file);
          let value;
          try { value = await readTextFile(selected.file, { on: selected.on }); }
          catch (error) { if (!draft || !this.dirty(draft)) throw error; value = null; }
          if (!active()) return;
          if (draft && (this.dirty(draft) || draft.saving)) {
            this.document = draft; draft.external = value !== draft.base;
            this.text = draft.text; this.truncated = false;
            this.pin();
          } else {
            if (value === null) throw new Error("This file is no longer available.");
            if (value.includes("\0")) throw new Error("This binary file has no text preview.");
            this.truncated = value.length > TEXT_LIMIT;
            if (this.truncated) {
              const end = /[\uDC00-\uDFFF]/.test(value[TEXT_LIMIT]) ? TEXT_LIMIT - 1 : TEXT_LIMIT;
              this.text = value.slice(0, end) + TRUNCATION_NOTICE;
            } else this.text = value;
            if (!selected.on && !this.truncated) {
              this.document = { file: selected.file, base: value, text: value };
              this.documents.set(selected.file, this.document);
            }
          }
          if (type === "markdown") {
            const text = this.text, look = appearance();
            const staged = await stageMarkdown(text, selected, look);
            if (!active()) return;
            if (text === this.text) this.acceptMarkdown(staged, look, cx);
          } else if (richText(type)) this.refreshData();
          if (!active()) return;
          this.updateEditor();
        }
      } catch (error) { if (active()) this.error = String(error.message || error); }
      finally {
        if (active()) {
          this.loading = false;
          if (this.handle.is_focused()) this.focusContent();
          if (this.reloadPending) { this.reloadPending = false; this.reload(cx); }
          cx.notify();
        }
      }
    });
    if (notify) cx.notify();
  }

  poll(cx) {
    const type = kind(this.selected.file);
    if (type !== "image" && type !== "pdf") { this.reload(cx); return; }
    // Remote media is unsupported; polling must not repeatedly clear that state.
    if (this.selected.on || this.loading || this.mediaPoll === this.request) return;
    const request = this.mediaPoll = this.request, selected = this.selected;
    cx.spawn(async cx => {
      try {
        const signature = await mediaSignature(selected);
        if (!this.current(request)) return;
        if (signature !== this.media?.signature) this.load(cx);
        else if (this.error) { this.error = null; cx.notify(); }
      } catch (error) {
        if (this.current(request)) { this.error = String(error.message || error); cx.notify(); }
      } finally { if (this.mediaPoll === request) this.mediaPoll = null; }
    });
  }

  reload(cx) {
    if (this.selected) {
      if (this.document) {
        const doc = this.document, request = this.request;
        cx.spawn(async cx => {
          try {
            const disk = await readTextFile(doc.file);
            if (!this.current(request) || this.document !== doc) return;
            if (!this.dirty(doc) && !doc.saving && disk !== doc.base) { this.load(cx); return; }
            doc.external = disk !== doc.base;
          } catch {
            if (this.current(request)) {
              if (!this.dirty(doc) && !doc.saving) { this.load(cx); return; }
              doc.external = true;
            }
          }
          if (this.current(request)) {
            if (!this.source && kind(doc.file) === "markdown") this.refreshMarkdown(cx);
            cx.notify();
          }
        });
        return;
      }
      if (this.loading) this.reloadPending = true; else this.load(cx);
    } else this.tree?.refresh(cx);
  }

  watchTargets(files, cx) {
    this.watchedFiles = new Set(files.map(normalize));
    const directories = new Set(files.map(dirname));
    for (const dir of this.watchErrors.keys()) if (!directories.has(dir)) this.watchErrors.delete(dir);
    for (const [dir, token] of this.watchers) if (!directories.has(dir)) { this.watchers.delete(dir); token.pending?.cancel(); }
    for (const dir of directories) {
      if (this.watchers.has(dir)) continue;
      const token = { pending: null }; this.watchers.set(dir, token);
      cx.spawn(async cx => {
        try {
          // Register first so saves during physical-path resolution remain queued.
          token.pending = watchFolder(dir);
          const windows = window()?.platform === "windows";
          const physicalPath = windows ? Promise.resolve(dir) : exec("pwd", ["-P"], { cwd: dir }).then(result => result.stdout.trim() || dir);
          const pathKey = path => windows ? normalize(path).toLowerCase() : normalize(path);
          while (!this.closed && this.watchers.get(dir) === token) {
            const [changed, physical] = await Promise.all([token.pending, physicalPath]);
            if (this.closed || this.watchers.get(dir) !== token || !changed.length) return;
            if (this.watchErrors.delete(dir)) cx.notify();
            // A directory event can represent an atomic save or a folder rename.
            if (changed.some(path => {
              const value = pathKey(path);
              return [...this.watchedFiles].some(file => {
                const canonical = pathKey(dirname(file) === dir ? `${physical}/${basename(file)}` : file), original = pathKey(file);
                return original === value || canonical === value || canonical.startsWith(value + "/");
              });
            })) this.reload(cx);
            token.pending = watchFolder(dir);
          }
        } catch (error) {
          if (this.watchers.get(dir) === token) { this.watchErrors.set(dir, String(error.message || error)); cx.notify(); }
        } finally {
          token.pending?.cancel();
          if (this.watchers.get(dir) === token) this.watchers.delete(dir);
        }
      });
    }
  }

  get watchError() { return [...this.watchErrors.values()].join("\n") || null; }

  follow(href, cx) {
    if (!this.selected) return;
    try {
      const link = resolveLink(this.selected.file, href);
      if (link.url) cx.open_url(link.url);
      else if (link.file && link.file !== this.selected.file) {
        if (this.pinned()) throw new Error("Unpin before following another file.");
        this.show({ ...this.selected, file: link.file }, cx, true, true, link.anchor || "");
      }
      else if (link.anchor !== undefined && kind(this.selected.file) === "markdown") {
        if (link.anchor && !this.headings?.some(h => h.slug === link.anchor)) throw new Error(`Heading not found: #${link.anchor}`);
        if (this.anchor === link.anchor && !this.source) return;
        this.remember(); this.anchor = link.anchor; this.source = false; this.actionError = null; cx.notify();
      }
    } catch (error) { this.actionError = String(error.message || error); cx.notify(); }
  }

  back(cx) {
    this.navigation = null;
    this.locationError = null;
    this.takePosition();
    if (this.pinned() && this.history.length && this.history[this.history.length - 1].target.file !== this.selected.file) {
      run("layout.select", { stack: this.owner.stack, child: "files-plus-tree" }); run("files-plus.return"); return;
    }
    if (this.history.length) {
      const previous = this.history.pop();
      const same = this.selected?.file === previous.target.file && this.selected?.on === previous.target.on;
      this.selected = previous.target; this.source = previous.source; this.zoom = previous.zoom; this.page = previous.page; this.total = 0;
      this.anchor = previous.anchor || ""; this.contents = previous.contents || false; this.expanded = new Set(previous.expanded || [""]);
      if (same && this.code) { this.actionError = null; this.setSource(this.source, cx); } else this.load(cx);
    } else if (this.owner.mode === "paired") {
      run("layout.select", { stack: this.owner.stack, child: "files-plus-tree" });
      run("files-plus.return");
    }
    else if (this.owner.mode === "files") {
      this.selected = null; this.request = null; this.releaseEditor(); this.document = null; this.media = null; this.error = null; this.actionError = null;
      this.watchTargets([], cx); this.tree?.watch(cx); this.tree?.refresh(cx); cx.notify();
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
    const request = this.request, position = request?.position;
    if (!this.loading && position && !position.scheduled) {
      position.scheduled = true;
      cx.timer.after(0, cx => this.applyPosition(request, position, cx));
    }
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
    if (type === "markdown" && !this.source && !this.loading && !this.error && !this.markdownBusy && this.markdownLook !== JSON.stringify(appearance())) {
      // Appearance changes also invalidate diagrams, including custom colors in
      // the same light/dark appearance. Keep render itself free of host mutations.
      cx.spawn(async cx => { if (!this.closed && this.selected?.file === file && !this.markdownBusy) this.refreshMarkdown(cx); });
    }
    const panelFrame = this.owner.mode !== "pane";
    return v_flex().id("preview-plus").track_focus(this.handle).size_full().min_w(0).min_h(0).overflow_hidden().bg(colors.background)
      .when(panelFrame, el => el.rounded(10).border_1().border_color(colors.border)).text_color(colors.foreground).font_family(font).text_size(13)
      .on_key_down((event, cx) => this.keyDown(event, cx))
      .child(h_flex().id("preview-toolbar").h(42).flex_none().px(8).gap(2).items_center().border_b(0.5).border_color(colors.border)
        .when(Boolean(file) && panelFrame, el => el.child(button("preview-back", "←", colors, cx => this.back(cx))))
        .child(div().flex_1().min_w(0).px(4).font_semibold().truncate().when(Boolean(file), el => el.tooltip(file)).child(file ? basename(file) : "Files"))
        .when(Boolean(file) && this.owner.mode === "paired", el => el.child(button("preview-pin", this.pinned() ? "Unpin (F7)" : "Pin (F7)", colors, cx => this.togglePin(cx), true, this.pinned(), "lock")))
        .when(this.dirty() || Boolean(this.document?.saving), el => el.child(div().id("preview-dirty").size(6).mr(4).flex_none().rounded_full().bg(colors.muted)
          .tooltip(this.document?.saving ? "Saving…" : "Unsaved changes").accessibility_label(this.document?.saving ? "Saving" : "Unsaved changes")))
        .when(Boolean(this.code) && !this.document, el => el.child(div().size(16).flex_none().flex().items_center().justify_center().text_color(colors.dim)
          .tooltip(this.selected.on ? "Remote file is read-only" : "Truncated file is read-only").accessibility_label("Read-only")
          .child(svg("mods/preview-plus/icons/lock.svg").size(12))))
        .when(type === "markdown" && !this.source && Boolean(this.headings?.length), el => el
          .child(button("preview-contents", "Contents", colors, cx => { this.contents = !this.contents; cx.notify(); }, true, this.contents)))
        .when(richText(type), el => el
          .child(button("preview-mode", this.source ? "Preview" : "Source", colors, cx => this.setSource(!this.source, cx), Boolean(this.code), false, this.source ? "preview" : "code")))
        .when(Boolean(file) && !media, el => el
          .child(button("preview-wrap", "Wrap lines", colors, cx => this.toggleWrap(cx), Boolean(this.code) && (!richText(type) || this.source), this.wrap)))
        .when(Boolean(this.document), el => el
          .when(this.dirty(), el => el.child(button("preview-discard", this.confirmDiscard ? "Confirm discard" : "Discard changes", colors, cx => this.discard(cx), !this.document.saving, this.confirmDiscard, this.confirmDiscard ? "check" : "undo")))
          .when(Boolean(this.confirmDiscard), el => el.child(button("preview-cancel-discard", "Cancel discard", colors, cx => { this.confirmDiscard = false; cx.notify(); })))
          .child(button("preview-save", this.document.saving ? "Saving…" : `Save (${window()?.platform === "macos" ? "⌘S" : "Ctrl+S"})`, colors, cx => this.save(cx), this.dirty() && !this.document.saving)))
        .when(Boolean(file), el => el.child(button("preview-open", "Open", colors, cx => this.open(cx), !this.selected.on)))
        .when(!file, el => el.child(button("preview-refresh", "Refresh", colors, cx => this.reload(cx), Boolean(this.tree) && !this.tree.loading))))
      .when(Boolean(file || this.owner.cwd), el => el.child(div().h(28).flex_none().px(16).flex().items_center().text_size(12).text_color(colors.muted).truncate().child(file ? dirname(file) : this.owner.cwd)))
      .when(Boolean(this.sourceReady()), el => el.child(this.sourceNavigation(colors)))
      .when(Boolean(this.locationError), el => el.child(div().id("preview-location-error").px(16).py(6).text_size(12).text_color(colors.ansi1).child(this.locationError)))
      .when(Boolean(this.document?.external), el => el.child(div().px(16).py(8).text_size(12).text_color(colors.muted).child("File changed on disk. Your draft is retained; saving checks for conflicts.")))
      .when(Boolean(this.document?.saveError || this.draftError), el => el.child(div().px(16).py(8).text_size(12).text_color(colors.ansi1).child(this.document?.saveError || this.draftError)))
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
      .when(Boolean(this.watchError), el => el.child(div().px(16).py(8).text_size(12).text_color(colors.muted).child(`Live refresh unavailable: ${this.watchError}. Periodic refresh remains active.`)))
      .when(Boolean(this.imageWarning && !this.source), el => el.child(div().px(16).py(8).text_size(12).text_color(colors.muted).child(this.selected?.on ? "Inline images are only available for local files." : "Some inline images could not be loaded.")))
      .when(!file && Boolean(this.tree), el => el.child(this.tree.render(colors, (value, cx) => this.show(value, cx))))
      .when(!file && !this.tree, el => el.child(div().p(16).text_size(12).text_color(colors.muted).child(this.owner.mode === "pane" ? "Pass an absolute file path to Preview Plus." : "Select a file in Files Plus.")))
      .when(Boolean(file), el => el.child(this.body(type, colors)));
  }

  sourceNavigation(colors) {
    const mode = this.navigation, find = mode === "find", result = this.findResult;
    const count = find ? result.ranges.length : 0, total = count + (find && result.limited ? "+" : "");
    const status = count ? (result.active < 0 ? `${total} matches` : `${result.active + 1} / ${total}`) : "0 matches";
    return v_flex().flex_none().px(8).border_b_1().border_color(colors.border)
      .child(h_flex().gap(2).items_center()
        .child(button("preview-go-to", "Go to line", colors, cx => this.toggleNavigation("go", cx), true, mode === "go"))
        .child(button("preview-find", "Find in Source", colors, cx => this.toggleNavigation("find", cx), true, find))
        .when(this.truncated, el => el.child(div().px(6).text_size(12).text_color(colors.muted).child("Partial source"))))
      .when(Boolean(mode), el => el.child(h_flex().gap(4).pb(6).items_center().flex_wrap()
        .child(Input.new(find ? this.findInput : this.goInput).id("preview-navigation-input").flex_1().min_w(130).h(28).px(6)
          .border(0.5).border_color(colors.input).rounded(6).accessibility_label(find ? "Find literal text" : "Line or line:column"))
        .when(find, el => el
          .child(button("preview-find-previous", "↑", colors, cx => this.stepFind(-1, cx), count > 0))
          .child(button("preview-find-next", "↓", colors, cx => this.stepFind(1, cx), count > 0))
          .child(div().id("preview-find-count").flex_none().px(4).text_size(12).text_color(colors.muted)
            .accessibility_label(status).child(status)))
        .when(!find, el => el.child(button("preview-go-submit", "Go", colors, cx => this.goTo(cx))))
        .child(button("preview-navigation-close", "Close", colors, cx => this.closeNavigation(cx), true, false, "close"))));
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
    if (type === "markdown" && !this.source) return markdownView(this, colors);
    if (richText(type) && !this.source) return structuredView(this, type, colors);
    return this.code ? Editor.new(this.code).flex_1().min_h(0) : div().flex_1();
  }

  measure(size, cx) {
    // Measurements are window points; builder dimensions also receive Herdr's zoom.
    const zoom = settings().zoom || 1, viewport = { width: size.width / zoom, height: size.height / zoom };
    if (Math.abs(this.viewport.width - viewport.width) > 0.5 || Math.abs(this.viewport.height - viewport.height) > 0.5) { this.viewport = viewport; this.clampPan(); cx.notify(); }
  }

  async close() {
    this.closed = true; this.request = null; this.watchTargets([], null); this.tree?.close(); this.releaseEditor(); this.zoomInput.release();
    this.goInput.release(); this.findInput.release();
    this.persistDrafts(); await localStorage.flush();
  }
}
