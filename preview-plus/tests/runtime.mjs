import vm from "node:vm";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execute = promisify(execFile), runtimeDir = fileURLToPath(new URL("../mods/preview-plus/", import.meta.url));

export async function runtime(t) {
  const dir = await fs.mkdtemp("/tmp/pp-test.");
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const state = { dir, platform: "macos", props: {}, shared: {}, calls: [], tasks: [], timers: [], hooks: {}, watches: new Map() };
  state.settings = { dark: true, ui_font_family: "Geist", font_family: "JetBrains Mono", font_size: 14 };
  state.theme = { background: "#111113", surface: "#18191b", popover: "#18191b", raised: "#212225", hover: "#272a2d", selected: "#2e3135", border: "#ffffff18", input: "#ffffff24", foreground: "#edeef0", muted: "#b0b4ba", dim: "#777b84", accent: "#70b8ff", accent_foreground: "#111113", solid: "#edeef0", solid_foreground: "#111113", ansi1: "#ff9592", ansi2: "#3dd68c", ansi3: "#ffca16", ansi4: "#70b8ff", ansi5: "#d19dff", ansi6: "#53b9ab" };
  state.spaces = [{ id: "s1", active: true, folder: dir, machine: null }];
  state.panes = [{ pane: "p1", cwd: dir }]; state.focus = { space: "s1", pane: "p1", cwd: dir, terminal: "t1" };
  const host = {
    appHome: () => path.join(dir, "app"), window: () => ({ platform: state.platform }), settings: () => ({ ...state.settings, zoom: state.zoom || 1 }), theme: () => state.theme,
    props: () => state.props, shared: key => state.shared[key], spaces: () => state.spaces, panes: () => state.panes, focused: () => state.focus,
    readTextFile: async (file, options) => {
      if (state.hooks.read) return state.hooks.read(file, options);
      try { const value = await fs.readFile(file, "utf8"); if (Buffer.byteLength(value) > 1048576) throw new Error("File too large"); return value; }
      catch (error) { if (error.code === "ENOENT") return null; throw error; }
    },
    exec: async (command, args = [], options = {}) => {
      state.calls.push({ command, args: [...args], options });
      if (state.hooks.exec) { const result = await state.hooks.exec(command, args, options); if (result) return result; }
      try { return { code: 0, ...(await execute(command, [...args], { cwd: options.cwd, maxBuffer: 8 * 1024 * 1024 })) }; }
      catch (error) { if (typeof error.code !== "number") throw error; return { code: error.code, stdout: error.stdout, stderr: error.stderr }; }
    },
    watchFolder: dir => new Promise(resolve => { state.watches.set(dir, resolve); }),
    nextCommand: () => new Promise(() => {}),
    run: (command, args) => state.calls.push({ command, args })
  };
  const builder = (kind, value) => {
    const data = { kind, value, nodes: [], handlers: {}, attributes: {} };
    let element;
    element = new Proxy(data, { get(target, key) {
      if (key in target) return target[key];
      if (key === "then") return undefined;
      if (key === "when") return (condition, fn) => { if (condition) fn(element); return element; };
      if (key === "child") return child => { target.nodes.push(child); return element; };
      if (key === "children") return children => { target.nodes.push(...children); return element; };
      if (String(key).startsWith("on_")) return (...args) => { target.handlers[key] = args.at(-1); return element; };
      return (...args) => { target.attributes[key] = args; return element; };
    } });
    return element;
  };
  const kit = { View: class {}, div: () => builder("div"), image: file => builder("image", file) };
  const base = { h_flex: () => builder("row"), v_flex: () => builder("column"),
    TextView: { markdown: (id, text) => builder("markdown", text).id(id) },
    EditorState: { new: options => ({ ...options, release() { this.released = true; } }) }, Editor: { new: code => builder("editor", code) } };
  const context = vm.createContext({ console }), cache = new Map();
  async function module(file) {
    if (cache.has(file)) return cache.get(file);
    const result = new vm.SourceTextModule(await fs.readFile(file, "utf8"), { context, identifier: file }); cache.set(file, result);
    await result.link(async (specifier, parent) => {
      const exports = specifier === "herdr" ? host : specifier === "gpui-kit" ? kit : specifier === "gpui-base" ? base : null;
      if (!exports) return module(path.resolve(path.dirname(parent.identifier), specifier));
      return new vm.SyntheticModule(Object.keys(exports), function () { for (const [key, value] of Object.entries(exports)) this.setExport(key, value); }, { context });
    });
    return result;
  }
  state.load = async name => { const loaded = await module(path.join(runtimeDir, name)); if (loaded.status !== "evaluated") await loaded.evaluate(); return loaded.namespace; };
  state.cx = { notify() { if (state.rendering) throw new Error("notify during render"); }, open_url: url => state.calls.push({ command: "open_url", url }),
    spawn: fn => { const task = Promise.resolve().then(() => fn(state.cx)); state.tasks.push(task); return task; }, timer: { every: (ms, fn) => state.timers.push({ ms, fn }) } };
  // Watchers and nextCommand deliberately remain pending. Drain only finite work.
  state.settle = async () => {
    for (let n = 0; n < 800; n++) {
      if (!state.panel?.loading && !state.panel?.tree?.loading && !state.panel?.tree?.pending.size) { await new Promise(resolve => setImmediate(resolve)); if (!state.panel?.loading) return; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error("Panel did not settle");
  };
  state.start = async () => { const { default: Panel } = await state.load("main.js"); state.panel = new Panel(); state.panel.init({}, state.cx); await state.settle(); return state.panel; };
  state.render = () => { state.rendering = true; try { return state.panel.render(state.cx); } finally { state.rendering = false; } };
  state.change = async (dir, paths) => { const resolve = state.watches.get(dir); if (!resolve) throw new Error("No watcher for " + dir); resolve(paths); await new Promise(resolve => setImmediate(resolve)); await state.settle(); };
  return state;
}

export function find(element, id) {
  if (!element || typeof element !== "object") return null;
  if (element.attributes?.id?.[0] === id) return element;
  for (const child of element.nodes || []) { const found = find(child, id); if (found) return found; }
  return null;
}
