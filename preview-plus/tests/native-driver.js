// Test-only subclass: exercise production handlers and record native state.
import PreviewPlus from "./panel.js";
import { props, readTextFile, writeTextFile, watchFolder, shared, setShared, closeOverlay, settings, theme } from "herdr";

export default class NativeDriver extends PreviewPlus {
  init(p, cx) {
    this.base = props().base;
    if (!shared("frame.welcomed")) setShared("frame.welcomed", "skipped");
    closeOverlay("frame-welcome");
    super.init(p, cx);
    cx.timer.every(100, cx => this.record(cx));
    cx.spawn(async cx => {
      for (;;) {
        try {
          const text = await readTextFile(`${this.base}/request.json`), request = text ? JSON.parse(text) : null;
          if (request && request.id !== this.handled) {
            this.handled = request.id;
            try {
              if (request.action === "activate") { globalThis.window.activate_window(); globalThis.window.refresh(); cx.notify(); }
              else if (request.action === "show") this.show({ file: request.file, root: request.root, on: request.on }, cx);
              else if (request.action === "follow") this.follow(request.href, cx);
              else if (request.action === "back") this.back(cx);
              else if (request.action === "source") { this.source = request.value; cx.notify(); }
              else if (request.action === "zoom") this.setZoom(request.value, cx);
              else if (request.action === "page") this.turnPage(request.delta, cx);
              else if (request.action === "toggle") this.tree.toggle(request.path, cx);
              else if (request.action === "refresh") this.reload(cx);
              await writeTextFile(`${this.base}/receipt.json`, JSON.stringify({ id: request.id }), await readTextFile(`${this.base}/receipt.json`));
            } catch (error) {
              await writeTextFile(`${this.base}/receipt.json`, JSON.stringify({ id: request.id, error: String(error) }), await readTextFile(`${this.base}/receipt.json`));
            }
          }
        } catch (error) { console.log("Preview fixture: " + String(error)); }
        await watchFolder(this.base);
      }
    });
  }

  render(cx) {
    const element = super.render(cx);
    this.record(cx);
    return element;
  }

  record(cx) {
    const value = { owner: this.owner, selected: this.selected, loading: this.loading, error: this.error, actionError: this.actionError,
      imageWarning: this.imageWarning, text: this.text, markdownBlocks: this.markdownBlocks, source: this.source, media: this.media,
      page: this.page, total: this.total, zoom: this.zoom, history: this.history, viewport: this.viewport,
      uiFont: settings().ui_font_family, codeFontSize: settings().font_size, appZoom: settings().zoom, codeStyle: this.codeStyle, colors: theme(), windowActive: globalThis.window?.is_window_active?.(),
      tree: this.tree ? { folders: [...this.tree.folders], entries: Object.fromEntries(this.tree.entries), error: this.tree.error, loading: this.tree.loading } : null };
    const text = JSON.stringify(value);
    if (this.base && this.recorded !== text && !this.recording) {
      this.recording = true;
      cx.spawn(async () => {
        try { const file = `${this.base}/state.json`; await writeTextFile(file, text, await readTextFile(file)); this.recorded = text; }
        finally { this.recording = false; }
      });
    }
  }
}
