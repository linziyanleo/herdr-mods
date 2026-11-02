import vm from "node:vm";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execute = promisify(execFile);
const runtimeDir = process.env.FILES_PLUS_RUNTIME || fileURLToPath(new URL("../mods/files-plus/", import.meta.url));

export async function runtime(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "files-plus-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.mkdir(path.join(dir, "home"));
  const state = { dir, platform: "macos", props: {}, shared: {}, calls: [], clipboard: "original clipboard", focus: null, panes: [], spaces: [], hooks: {}, tasks: [], timers: [], settings: { dark: true, ui_font_family: "Geist", ui_font_size: 13, font_family: "JetBrains Mono", font_size: 14 }, layout: {}, rebuiltRows: 0, notifications: 0 };
  state.theme = { background: "#111113", popover: "#18191b", raised: "#212225", hover: "#272a2d", selected: "#2e3135", border: "#363a3f", input: "#43484e", foreground: "#edeef0", muted: "#b0b4ba", dim: "#777b84", accent: "#b0b4ba", solid: "#edeef0", solid_foreground: "#111113", ansi1: "#ff9592", ansi2: "#3dd68c", ansi3: "#ffca16", ansi4: "#70b8ff", ansi5: "#d19dff", ansi6: "#53b9ab" };
  state.semantic = { colors: { border: "#ffffff" }, appearance: "dark", is_dark: true,
    spacing: { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 }, radius: { none: 0, sm: 3, md: 6, lg: 8, xl: 12, full: 9999 },
    typography: { sans: ".SystemUIFont", mono: "Menlo", xs: { size: 12, line_height: 16, weight: 400 }, sm: { size: 14, line_height: 20, weight: 400 }, md: { size: 16, line_height: 24, weight: 400 }, lg: { size: 18, line_height: 28, weight: 400 }, xl: { size: 20, line_height: 28, weight: 400 }, mono_md: { size: 13, line_height: 20, weight: 400 } } };
  state.spaces = [{ id: "s1", name: "Product", folder: dir, machine: null, active: true, tabs: [{ id: "tab1", active: true }] }];
  state.panes = [{ pane: "p1", terminal: "t1", cwd: dir, tab: "tab1" }];
  state.focus = { space: "s1", tab: "tab1", pane: "p1", terminal: "t1", cwd: dir };
  const host = {
    home: () => path.join(dir, "home"), appHome: () => path.join(dir, "app"),
    spaces: () => state.spaces, panes: () => state.panes, focused: () => state.focus,
    machines: () => [{ name: null, layout: "ready" }], window: () => ({ platform: state.platform }), settings: () => state.settings, theme: () => state.theme, layout: () => state.layout,
    props: () => state.props, shared: key => state.shared[key], setShared: (key, value) => { state.shared[key] = value; },
    readTextFile: async file => {
      await state.hooks.beforeRead?.(file);
      try { const text = await fs.readFile(file, "utf8"); if (Buffer.byteLength(text) > 1048576) throw new Error("File too large"); return text; }
      catch (error) { if (error.code === "ENOENT") return null; throw error; }
    },
    writeTextFile: async (file, text, expected) => {
      if (await host.readTextFile(file) !== expected) throw new Error("Stale snapshot");
      await fs.writeFile(file, text);
      await state.hooks.afterWrite?.();
    },
    exec: async (command, args = [], options = {}) => {
      state.calls.push({ command, args: [...args], ...options });
      if (state.hooks.exec) { const result = await state.hooks.exec(command, args, options); if (result) return result; }
      if (["open", "xdg-open", "explorer.exe"].includes(command)) return { code: 0, stdout: "", stderr: "" };
      try { const result = await execute(command, [...args], { cwd: options.cwd, maxBuffer: 8 * 1024 * 1024 }); return { code: 0, ...result }; }
      catch (error) { if (typeof error.code !== "number") throw error; return { code: error.code, stdout: error.stdout, stderr: error.stderr }; }
    },
    watchFolder: async () => { throw new Error("Native watchers are exercised in Herdr"); },
    run: (command, args) => {
      state.calls.push({ command, args });
      if (command === "pane.focus") { const p = state.panes.find(p => p.terminal === args.terminal); state.focus = p ? { ...state.focus, ...p } : null; }
      if (command === "terminal.paste") state.pasted = state.clipboard;
    },
    openOverlay: spec => { state.calls.push({ command: "openOverlay", spec }); return "overlay"; },
    closeOverlay: id => { state.calls.push({ command: "closeOverlay", id }); },
    pickFolder: async () => state.picked ?? null
  };
  // Keep builders separate from their plain inspection data.
  function builder(kind, value) {
    const data = { kind, value, nodes: [], handlers: {}, attributes: {} };
    let el;
    el = new Proxy(data, { get(target, key) {
      if (key in target) return target[key];
      if (key === "then") return undefined;
      if (key === "when") return (condition, fn) => { if (condition) fn(el); return el; };
      if (key === "child") return child => { target.nodes.push(child); return el; };
      if (key === "children") return children => { target.nodes.push(...children); return el; };
      if (String(key).startsWith("on_")) return (...args) => { target.handlers[key] = args.at(-1); if (args.length > 1) target.handlers[`${key}:${args[0]}`] = args.at(-1); return el; };
      return (...args) => { if (key === "id" && /^(file|root)-/.test(args[0])) state.rowBuilds = (state.rowBuilds || 0) + 1; target.attributes[key] = args; return el; };
    } });
    return el;
  }
  const input = options => ({ text: options?.value || "", value() { return this.text; }, set_value(text) { this.text = text; }, set_selected_range() {}, on() {}, focus() {}, release() {} });
  const kit = { View: class {}, div: () => builder("div"), svg: file => builder("svg", file) };
  const base = { v_flex: () => builder("column"), h_flex: () => builder("row"), InputState: { new: input }, Input: { new: value => builder("input", value) },
    EditorState: { new: options => ({ ...options, release() { this.released = true; } }) }, Editor: { new: value => builder("editor", value) } };
  const context = vm.createContext({ console, window: { viewport_size: () => state.viewport || { width: 1600, height: 1000 } } });
  const cache = new Map();
  async function module(file) {
    if (cache.has(file)) return cache.get(file);
    const result = new vm.SourceTextModule(await fs.readFile(file, "utf8"), { context, identifier: file });
    cache.set(file, result);
    return result;
  }
  async function link(specifier, parent) {
      const exports = specifier === "herdr" ? host : specifier === "gpui-kit" ? kit : specifier === "gpui-base" ? base : null;
      if (!exports) return module(path.resolve(path.dirname(parent.identifier), specifier));
      const synthetic = new vm.SyntheticModule(Object.keys(exports), function () { for (const [key, value] of Object.entries(exports)) this.setExport(key, value); }, { context });
      return synthetic;
  }
  state.load = async name => { const mod = await module(path.join(runtimeDir, name)); if (mod.status === "unlinked") await mod.link(link); if (mod.status !== "evaluated") await mod.evaluate(); return mod.namespace; };
  state.cx = { theme: () => state.semantic, notify(entity) { if (entity) entity.dirty = true; else state.notifications++; }, stop_propagation() {}, sleep: async () => {},
    new(Class, props) {
      const view = new Class(), entity = { view, dirty: true, released: false,
        set_props(props) { view.update?.(props); this.dirty = true; },
        release() { this.released = true; return true; },
        snapshot() {
          if (this.dirty) { this.dirty = false; if (Class.name === "RowChunk") state.rebuiltRows += view.data.rows.length; this.element = view.render(state.cx); }
          return this.element;
        }
      };
      view.init?.(props, state.cx); return entity;
    },
    focus_handle: () => ({ focus() {} }), read_from_clipboard: () => state.clipboard, write_to_clipboard: text => { state.clipboard = text; },
    spawn: fn => { const task = Promise.resolve().then(() => fn(state.cx)); state.tasks.push(task); return task; },
    timer: { every: (ms, fn) => state.timers.push({ ms, fn, repeat: true }), after: (ms, fn) => state.timers.push({ ms, fn }) }
  };
  state.drain = async () => {
    while (state.tasks.length || state.timers.some(timer => !timer.repeat && timer.ms === 0)) {
      while (state.tasks.length) await Promise.all(state.tasks.splice(0));
      const ready = state.timers.filter(timer => !timer.repeat && timer.ms === 0);
      state.timers = state.timers.filter(timer => !ready.includes(timer));
      for (const timer of ready) timer.fn(state.cx);
    }
  };
  state.advance = async ms => {
    const ready = state.timers.filter(timer => !timer.repeat && timer.ms <= ms);
    state.timers = state.timers.filter(timer => !ready.includes(timer));
    for (const timer of ready) timer.fn(state.cx);
    await state.drain();
  };
  state.target = (name = "", kind = "file", root = dir) => ({ space: "s1", path: path.join(dir, name), kind, root, on: null, active: { pane: "p1", terminal: "t1", cwd: root } });
  return state;
}

export function find(element, id) {
  if (!element || typeof element !== "object") return null;
  if (Object.hasOwn(element, "snapshot")) return find(element.snapshot(), id);
  if (element.attributes?.id?.[0] === id) return element;
  for (const child of element.nodes || []) { const result = find(child, id); if (result) return result; }
  return null;
}
