// Test-only subclass: exercise production handlers and record native state.
import PreviewPlus from "./panel.js";
import { props, readTextFile, writeTextFile, watchFolder, shared, setShared, closeOverlay, settings, theme } from "herdr";
import { jsonRows } from "./structured.js";

const DRIVER_OWNER = "preview-plus.native-driver-owner";

export default class NativeDriver extends PreviewPlus {
  init(p, cx) {
    this.base = props().base;
    this.driverIdentity = `${Date.now()}-${Math.random()}`;
    setShared(DRIVER_OWNER, { ...(shared(DRIVER_OWNER) || {}), [this.base]: this.driverIdentity });
    if (!shared("frame.welcomed")) setShared("frame.welcomed", "skipped");
    closeOverlay("frame-welcome");
    super.init(p, cx);
    cx.timer.every(100, cx => this.record(cx));
    cx.spawn(async cx => {
      while (this.ownsDriver()) {
        // Register before reading: a request can arrive while the prior receipt
        // is being written, before its caller starts the next request.
        const changed = watchFolder(this.base);
        try {
          const text = await readTextFile(`${this.base}/request.json`), request = text ? JSON.parse(text) : null;
          if (!this.ownsDriver()) return;
          if (request && request.id !== this.handled) {
            this.handled = request.id;
            let actionError;
            try {
              if (request.action === "activate") { globalThis.window.activate_window(); globalThis.window.refresh(); cx.notify(); }
              else if (request.action === "show") this.show({ file: request.file, root: request.root, on: request.on }, cx);
              else if (request.action === "follow") this.follow(request.href, cx);
              else if (request.action === "contents") { this.contents = !this.contents; cx.notify(); }
              else if (request.action === "json-toggle") this.toggleJson(request.path, cx);
              else if (request.action === "back") this.back(cx);
              else if (request.action === "source") this.setSource(request.value, cx);
              // set_value does not emit change; keyboard input is verified separately.
              else if (request.action === "edit") { this.code.set_value(request.value); this.editorChanged(this.code, cx); }
              else if (request.action === "save") this.save(cx);
              else if (request.action === "wrap") this.toggleWrap(cx);
              else if (request.action === "discard") this.discard(cx);
              else if (request.action === "key") this.keyDown({ keystroke: request.value }, cx);
              else if (request.action === "zoom") this.setZoom(request.value, cx);
              else if (request.action === "page") this.turnPage(request.delta, cx);
              else if (request.action === "toggle") this.tree.toggle(request.path, cx);
              else if (request.action === "refresh") this.reload(cx);
            } catch (error) { actionError = String(error); }
            // A transport failure must not masquerade as an action failure.
            await this.writeControl("receipt.json", JSON.stringify({ id: request.id, driverIdentity: this.driverIdentity, ...(actionError ? { error: actionError } : {}) }));
          }
        } catch (error) { console.log("Preview fixture: " + String(error)); }
        await changed;
      }
    });
  }

  render(cx) {
    this.renderCount = (this.renderCount || 0) + 1;
    const element = super.render(cx);
    this.record(cx);
    return element;
  }

  ownsDriver() { return !this.closed && shared(DRIVER_OWNER)?.[this.base] === this.driverIdentity; }

  async writeControl(name, text) {
    const file = `${this.base}/${name}`;
    for (let attempt = 0; attempt < 3 && this.ownsDriver(); attempt++) {
      const expected = await readTextFile(file);
      if (!this.ownsDriver()) return false;
      if (expected === text) return true;
      try { await writeTextFile(file, text, expected); return this.ownsDriver(); }
      catch (error) {
        if (!this.ownsDriver()) return false;
        // Only retry a demonstrated competing control-file write. Never use
        // this helper for the user's document or retry unchanged I/O errors.
        if (attempt === 2 || await readTextFile(file) === expected) throw error;
      }
    }
    return false;
  }

  record(cx) {
    if (!this.ownsDriver()) return;
    const value = { driverIdentity: this.driverIdentity, handledRequest: this.handled, renderCount: this.renderCount,
      owner: this.owner, selected: this.selected, loading: this.loading, error: this.error, actionError: this.actionError,
      imageWarning: this.imageWarning, text: this.text, markdownBlocks: this.markdownBlocks, source: this.source, media: this.media,
      headings: this.headings, anchor: this.anchor, contents: this.contents, markdownBusy: this.markdownBusy,
      dataError: this.dataPreview?.error, expanded: [...this.expanded],
      structuredRows: this.dataPreview ? (this.dataPreview.rows?.length ?? (this.dataPreview.error ? 0 : jsonRows(this.dataPreview.value, this.expanded).rows.length)) : 0,
      dirty: this.dirty(), document: this.document, wrap: this.wrap, codeText: this.code?.value(), draftError: this.draftError,
      page: this.page, total: this.total, zoom: this.zoom, history: this.history, viewport: this.viewport,
      uiFont: settings().ui_font_family, codeFontSize: settings().font_size, appZoom: settings().zoom, codeStyle: this.codeStyle, colors: theme(), windowActive: globalThis.window?.is_window_active?.(),
      tree: this.tree ? { folders: [...this.tree.folders], entries: Object.fromEntries(this.tree.entries), error: this.tree.error, loading: this.tree.loading } : null };
    const text = JSON.stringify(value);
    if (this.base && this.recorded !== text && !this.recording) {
      this.recording = true;
      cx.spawn(async () => {
        try { if (await this.writeControl("state.json", text)) this.recorded = text; }
        catch (error) { if (this.ownsDriver()) console.log("Preview fixture state: " + String(error)); }
        finally { this.recording = false; }
      });
    }
  }
}
