// Test-only wrapper. Copied beside the real runtime with main.js renamed panel.js.
import FilesPlus from "./panel.js";
import { div } from "gpui-kit";
import { props, nextCommand, readTextFile, writeTextFile, spaces, shared, setShared, openOverlay, focused, layout, settings, theme, closeOverlay, appHome } from "herdr";
import { location } from "./workspace.js";
import { parseConfig, setWorkspace } from "./roots.js";
import { menuItems, menuLayout } from "./actions.js";
import { metrics, viewport, zoom, dialogLayout } from "./metrics.js";
import { fps_monitor } from "gpui-fps";
import { workspaceSnapshot, changeRoots } from "./config.js";
import { appearance } from "./appearance.js";

export default class NativeDriver extends FilesPlus {
  close(cx) {
    if (this.clipboardBefore !== undefined && cx.read_from_clipboard() === "files-plus clipboard baseline") cx.write_to_clipboard(this.clipboardBefore);
    super.close(cx);
  }
  panelResized(size, cx) {
    this.sizeEvents = [...(this.sizeEvents || []), { size, at: Date.now(), requested: this.lastRequestedWidth, pending: Boolean(this.resizePending), viewport: viewport() }].slice(-20);
    super.panelResized(size, cx);
  }
  render(cx) {
    this.renderCount = (this.renderCount || 0) + 1; this.renderedLayout = layout();
    const content = super.render(cx);
    this.nativeRendered = true;
    return this.role ? content : div().relative().size_full().child(content).when(this.fps, el => el.child(fps_monitor()));
  }
  init(p, cx) {
    super.init(p, cx);
    const spec = { base: appHome().replace(/\/app$/, ""), ...props() };
    this.nativeBase = spec.base;
    this.nativeMod = spec.driverMod || "files-plus-driver";
    this.nativeStateId = spec.overlay || (spec.fit ? "panel-fit" : "panel");
    this.nativeIdentity = `${Date.now()}-${Math.random()}`;
    this.nativeOwnerEnabled = spec.owner !== false;
    if (spec.role === "drag") setShared("files-plus.native-drag", { starts: (shared("files-plus.native-drag")?.starts || 0) + 1, path: spec.target.path, at: Date.now() });
    if (!spec.role && this.nativeOwnerEnabled) setShared("files-plus.native-driver-owner", { ...(shared("files-plus.native-driver-owner") || {}), [this.nativeStateId]: this.nativeIdentity });
    if (spec.base) cx.timer.every(100, cx => this.record(cx));
    if (spec.role === "menu" && spec.choose) cx.timer.after(150, cx => this.choose(menuItems(this.targetEntry).findIndex(item => item.id === spec.choose), cx));
    if (spec.role === "dialog" && spec.submit) cx.timer.after(150, cx => {
      if (this.input) this.input.set_value(spec.name || "");
      this.submit(cx);
    });
    if (spec.role) return;
    cx.spawn(async cx => {
      for (;;) {
        await nextCommand();
        const request = JSON.parse(await readTextFile(`${spec.base}/request.json`));
        try {
          if (request.type === "workspace") {
            const id = spaces().find(s => s.active).id;
            if (request.file) {
              const parsed = parseConfig(await readTextFile(request.file), request.file);
              setWorkspace(id, { name: parsed.name, file: request.file, folders: parsed.folders });
            } else {
              const values = { ...(shared("multi-root.spaces") || {}) }; delete values[id]; setShared("multi-root.spaces", values);
            }
            this.refresh(cx);
          } else if (request.type === "menu" || request.type === "dialog") {
            const target = request.target || this.target(request.path, request.kind || "file", request.root);
            const pointer = request.pointer || { x: 520, y: 110 }, geometry = request.type === "menu" ? menuLayout(menuItems(target), request.error, metrics(cx), viewport(), pointer, zoom(), appearance(cx)) : dialogLayout(request.action, target, cx);
            this.requestOverlay = openOverlay({ mod: this.nativeMod, kind: request.type === "menu" ? "popup" : "dialog", modal: true, ...geometry,
              props: { role: request.type, target, geometry, pointer, error: request.error, choose: request.choose, action: request.action, submit: request.submit, name: request.name, base: spec.base, driverMod: this.nativeMod, owner: this.nativeOwnerEnabled } });
          } else if (request.type === "roots-snapshot") this.nativeSnapshot = await workspaceSnapshot(this.target(request.root, "root", request.root));
          else if (request.type === "change-roots") {
            const target = this.target(request.root, "root", request.root);
            await changeRoots(target, request.action, request.path, this.nativeSnapshot || await workspaceSnapshot(target));
            this.nativeSnapshot = null;
          } else if (request.type === "preview") this.openFile(request.path, request.root, cx);
          else if (request.type === "back") { this.show(null); cx.notify(); }
          else if (request.type === "toggle") this.toggle(request.path, cx);
          else if (request.type === "refresh") this.refresh(cx);
          else if (request.type === "activate") { globalThis.window.activate_window(); globalThis.window.refresh(); cx.notify(); }
          else if (request.type === "frame") globalThis.window.refresh();
          else if (request.type === "fps") { this.fps = request.show !== false; cx.notify(); }
          else if (request.type === "stats-start") globalThis.__fpStats = { rows: 0, exec: 0 };
          else if (request.type === "welcome-dismiss") { setShared("frame.welcomed", "skipped"); closeOverlay("frame-welcome"); }
          else if (request.type === "clipboard-start") { this.clipboardBefore = cx.read_from_clipboard(); cx.write_to_clipboard("files-plus clipboard baseline"); }
          else if (request.type === "clipboard-restore") { if (this.clipboardBefore !== undefined) cx.write_to_clipboard(this.clipboardBefore); }
          const value = { ok: true, overlay: ["menu", "dialog"].includes(request.type) ? this.requestOverlay : undefined, focused: focused(), windowActive: globalThis.window?.is_window_active?.(), clipboard: request.type === "snapshot" ? cx.read_from_clipboard() : undefined };
          await writeTextFile(`${spec.base}/receipt.json`, JSON.stringify(value), await readTextFile(`${spec.base}/receipt.json`));
          cx.notify();
        } catch (error) {
          await writeTextFile(`${spec.base}/receipt.json`, JSON.stringify({ error: error.message || String(error) }), await readTextFile(`${spec.base}/receipt.json`));
        }
      }
    });
  }
  record(cx) {
    const p = props() || {}, id = this.nativeStateId;
    if (!this.role && this.nativeOwnerEnabled && shared("files-plus.native-driver-owner")?.[id] !== this.nativeIdentity) return;
    const value = { role: this.role || "panel", file: this.file || null, fileError: this.fileError || null, error: this.error || null, busy: Boolean(this.busy),
      folders: [...(this.folders || [])], entries: Object.fromEntries(this.entries || []), marks: this.marks || {}, preview: this.code ? { readonly: true } : null, workspaces: shared("multi-root.spaces") || {} };
    if (!this.role) Object.assign(value, { context: this.context, location: location(), syncPending: this.syncPending, treeVersion: this.treeVersion, layout: layout(), zoom: settings().zoom,
      visible: this.visible, panelSize: this.panelSize, panelBounds: this.panelBounds, manualWidthSpace: this.manualWidthSpace, lastRequestedWidth: this.lastRequestedWidth, renderCount: this.renderCount, renderedLayout: this.renderedLayout,
      selectedFile: this.selectedFile, suppressClick: this.suppressClick, stats: globalThis.__fpStats, sizeEvents: this.sizeEvents,
      treeLook: this.chunks[0] ? JSON.parse(this.chunks[0].key).slice(1) : null, previewStyle: this.previewStyle,
      dragStarts: shared("files-plus.native-drag") });
    if (!this.role) Object.assign(value, { viewport: viewport(), metrics: metrics(cx), dark: settings().dark, look: settings(), colors: theme(), semantic: cx.theme(), windowActive: globalThis.window?.is_window_active?.(), windowBounds: globalThis.window?.bounds?.() });
    else Object.assign(value, { geometry: this.geometry, cursor: this.cursor, target: this.targetEntry, entered: Boolean(this.nativeRendered) });
    const text = JSON.stringify(value);
    if (this.recording || text === this.recorded) return;
    this.recording = true;
    cx.spawn(async () => {
      try {
        const file = `${this.nativeBase}/native-state-${id}.json`;
        await writeTextFile(file, text, await readTextFile(file)); this.recorded = text;
      } finally { this.recording = false; }
    });
  }
}
