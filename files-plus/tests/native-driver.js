// Test-only wrapper. Copied beside the real runtime with main.js renamed panel.js.
import FilesPlus from "./panel.js";
import { props, nextCommand, readTextFile, writeTextFile, spaces, shared, setShared, openOverlay, focused } from "herdr";
import { parseConfig, setWorkspace } from "./roots.js";
import { menuItems } from "./actions.js";
import { workspaceSnapshot, changeRoots } from "./config.js";

export default class NativeDriver extends FilesPlus {
  init(p, cx) {
    super.init(p, cx);
    const spec = props() || {};
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
          } else if (request.type === "menu" || request.type === "dialog") {
            const target = request.target || this.target(request.path, request.kind || "file", request.root);
            this.requestOverlay = openOverlay({ mod: "files-plus-driver", kind: request.type === "menu" ? "popup" : "dialog", modal: true, width: request.type === "menu" ? 272 : 440, height: request.type === "menu" ? 450 : 240, ...(request.type === "menu" ? { at: { x: 520, y: 110 } } : {}),
              props: { role: request.type, target, choose: request.choose, action: request.action, submit: request.submit, name: request.name, base: spec.base } });
          } else if (request.type === "roots-snapshot") this.nativeSnapshot = await workspaceSnapshot(this.target(request.root, "root", request.root));
          else if (request.type === "change-roots") {
            const target = this.target(request.root, "root", request.root);
            await changeRoots(target, request.action, request.path, this.nativeSnapshot || await workspaceSnapshot(target));
            this.nativeSnapshot = null;
          } else if (request.type === "preview") this.openFile(request.path, request.root, cx);
          else if (request.type === "back") { this.show(null); cx.notify(); }
          else if (request.type === "toggle") this.toggle(request.path, cx);
          else if (request.type === "clipboard-start") { this.clipboardBefore = cx.read_from_clipboard(); cx.write_to_clipboard("files-plus clipboard baseline"); }
          else if (request.type === "clipboard-restore") { if (this.clipboardBefore !== undefined) cx.write_to_clipboard(this.clipboardBefore); }
          const value = { ok: true, overlay: ["menu", "dialog"].includes(request.type) ? this.requestOverlay : undefined, focused: focused(), clipboard: request.type === "snapshot" ? cx.read_from_clipboard() : undefined };
          await writeTextFile(`${spec.base}/receipt.json`, JSON.stringify(value), await readTextFile(`${spec.base}/receipt.json`));
          cx.notify();
        } catch (error) {
          await writeTextFile(`${spec.base}/receipt.json`, JSON.stringify({ error: error.message || String(error) }), await readTextFile(`${spec.base}/receipt.json`));
        }
      }
    });
  }
  record(cx) {
    const p = props() || {}, id = p.overlay || "panel";
    const value = { role: this.role || "panel", file: this.file || null, fileError: this.fileError || null, error: this.error || null, busy: Boolean(this.busy),
      folders: [...(this.folders || [])], entries: Object.fromEntries(this.entries || []), marks: this.marks || {}, preview: this.code ? { readonly: true } : null, workspaces: shared("multi-root.spaces") || {} };
    const text = JSON.stringify(value);
    if (this.recording || text === this.recorded) return;
    this.recording = true;
    cx.spawn(async () => {
      const file = `${p.base}/native-state-${id}.json`;
      await writeTextFile(file, text, await readTextFile(file));
      this.recorded = text; this.recording = false;
    });
  }
}
