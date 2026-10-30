// Menu structure adapted from Herdr 0.1.9 new-menu (Apache-2.0).
import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, spaces, focused, home, knownAgents, run, openOverlay, closeOverlay, props, window, shared, pickFolder, exec, readTextFile } from "herdr";
import { SPACES, REPO, RECENT, workspaceOf, setWorkspace, reloadWorkspace, loadConfig, describeRoots, repositories, resolvePath, rootOf, label, basename, shortPath, putShared, remember } from "./roots.js";
import { saveWorkspace } from "./config.js";

let keysBound = false;

export default class MultiRoot extends View {
  init(_props, cx) {
    this.role = props()?.role || "new";
    this.spaceId = props()?.space || spaces().find(s => s.active)?.id;
    this.agents = []; this.roots = []; this.repos = []; this.recent = []; this.files = [];
    this.handle = cx.focus_handle(); this.handle.focus();
    const space = spaces().find(s => s.id === this.spaceId);
    if (space?.machine || window()?.platform === "windows") {
      closeOverlay(props()?.overlay); run("mod.open", { name: "new-menu" }); return;
    }
    if (this.role === "new" && !keysBound) {
      cx.bind_keys([{ keystroke: "cmd-t", action: "MultiRootTerminal", context: "MultiRootMenu" },
        ...Array.from({ length: 9 }, (_, i) => ({ keystroke: `cmd-${i + 1}`, action: `MultiRootAgent${i + 1}`, context: "MultiRootMenu" }))]);
      keysBound = true;
    }
    cx.spawn(async cx => {
      try {
        const entry = workspaceOf(this.spaceId);
        if (entry?.file) this.snapshot = props()?.snapshot || await reloadWorkspace(this.spaceId);
      } catch (error) { this.error = error.message || String(error); }
      if (props()?.action) { await this.perform(cx); return; }
      if (this.role === "new") {
        try {
          this.roots = await describeRoots(workspaceOf(this.spaceId)?.folders || []);
          const selected = this.roots.find(f => f.path === props()?.root) || rootOf(focused()?.cwd, this.roots) || this.roots.find(f => f.exists);
          this.root = selected?.exists ? selected.path : this.roots.find(f => f.exists)?.path;
          this.agents = await knownAgents();
        } catch { this.failed = true; }
      } else if (this.role === "repo-menu") {
        try { this.repos = await repositories(workspaceOf(this.spaceId)?.folders || []); }
        catch (error) { this.error = error.message || String(error); }
      } else if (this.role === "open") {
        this.recent = await Promise.all((shared(RECENT) || []).map(async file => {
          const text = await readTextFile(file).catch(() => null);
          let name = basename(file).replace(/\.herdr-workspace\.json$/, "");
          if (text) { try { name = JSON.parse(text).name || name; } catch { /* Opening reports malformed files. */ } }
          return { file, name, missing: text === null };
        }));
      }
      cx.notify();
    });
  }

  row(id, icon, name, action, hint = "", enabled = true) {
    const t = theme();
    return h_flex().id(id).h(31).px(9).gap(8).rounded(7).items_center().flex_none()
      .text_color(enabled ? t.foreground : t.dim).when(enabled, el => el.cursor_pointer().hover(s => s.bg(t.selected)))
      .on_click((_event, cx) => { if (enabled) { closeOverlay(props()?.overlay); action(cx); } })
      .child(icon).child(div().flex_1().min_w(0).truncate().child(name)).child(div().text_size(12).text_color(t.dim).child(hint));
  }

  dialog(action, extra = {}) {
    openOverlay({ mod: "multi-root", kind: "dialog", width: action ? 460 : 560, height: action ? 240 : 440,
      props: { role: "open", space: this.spaceId, ...(action ? { action, snapshot: this.snapshot } : {}), ...extra } });
  }

  start(agent) {
    const entry = workspaceOf(this.spaceId);
    run("tab.new", { space: this.spaceId, ...(entry ? { folder: this.root } : {}), ...(agent ? { name: agent.name, argv: agent.run } : {}) });
  }

  launch(agent, cx) {
    if (workspaceOf(this.spaceId) && !this.root) return;
    closeOverlay(props()?.overlay); this.start(agent); cx.stop_propagation();
  }

  makeWorkspace() {
    const space = spaces().find(s => s.id === this.spaceId), path = resolvePath(home(), focused()?.cwd || space.folder || home());
    setWorkspace(this.spaceId, { name: space.name, file: null, folders: [{ name: null, path, source: path }] });
  }

  async perform(cx) {
    this.busy = true; cx.notify();
    try {
      const entry = workspaceOf(this.spaceId), action = props()?.action;
      if (this.error) throw new Error(this.error);
      if (action === "add") {
        const picked = await pickFolder({ prompt: "Add" });
        if (picked) {
          const path = resolvePath(home(), picked);
          if (!entry.folders.some(f => f.path === path)) {
            const folders = [...entry.folders, { name: null, path, source: path }];
            if (entry.file) await saveWorkspace(this.spaceId, folders, this.snapshot);
            else setWorkspace(this.spaceId, { ...entry, folders });
          }
        }
      } else if (action === "remove") {
        if (entry.folders.length > 1) {
          const folders = entry.folders.filter(f => f.path !== props()?.root);
          if (entry.file) await saveWorkspace(this.spaceId, folders, this.snapshot);
          else setWorkspace(this.spaceId, { ...entry, folders });
        }
      } else if (action === "save") {
        let file = entry.file;
        if (!file) {
          const folder = await pickFolder({ prompt: "Save here" });
          if (!folder) { closeOverlay(props()?.overlay); return; }
          const slug = entry.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "workspace";
          file = resolvePath(folder, `${slug}.herdr-workspace.json`);
          if (await readTextFile(file) !== null) throw new Error("A workspace file with this name already exists here.");
        }
        await saveWorkspace(this.spaceId, entry.folders, this.snapshot, file);
      }
      closeOverlay(props()?.overlay);
    } catch (error) { this.error = error.message || String(error); this.busy = false; cx.notify(); }
  }

  openFile(file, cx) {
    if (this.busy) return;
    this.busy = true; this.error = null; cx.notify();
    cx.spawn(async cx => {
      try {
        const snapshot = await loadConfig(file);
        const existing = spaces().find(s => s.machine === null && shared(SPACES)?.[s.id]?.file === file);
        if (existing) { remember(file); closeOverlay(props()?.overlay); run("space.select", { id: existing.id }); return; }
        const roots = await describeRoots(snapshot.folders), first = roots.find(f => f.exists);
        const name = `${snapshot.name} (${Date.now()})`;
        this.opening = { file, snapshot, name, before: spaces().map(s => s.id) };
        run("space.new", { name, folder: first?.path || home() });
        cx.notify();
      } catch (error) { this.error = error.message || String(error); this.busy = false; cx.notify(); }
    });
  }

  chooseFolder(cx) {
    if (this.busy) return;
    cx.spawn(async cx => {
      try {
        const folder = await pickFolder({ prompt: "Open" });
        if (!folder) return;
        const result = await exec("sh", ["-c", 'for f in "$1"/*.herdr-workspace.json; do [ -f "$f" ] && printf "%s\\0" "$f"; done; exit 0', "multi-root", folder]);
        if (result.code !== 0) throw new Error(result.stderr);
        this.files = result.stdout.split("\0").filter(Boolean); this.chosen = true; this.error = null;
        if (this.files.length === 1) this.openFile(this.files[0], cx);
      } catch (error) { this.error = error.message || String(error); }
      cx.notify();
    });
  }

  renderNew() {
    const t = theme(), entry = workspaceOf(this.spaceId), installed = this.agents.filter(a => a.installed);
    const choices = [...installed, ...this.agents.filter(a => !a.installed).slice(0, 2)], enabled = !entry || Boolean(this.root);
    const divider = () => div().h(1).mx(4).my(5).bg(t.border);
    const menu = v_flex().id("multi-root-menu").h(420).w_full().min_h(0).bg(t.popover).p(5).text_size(13).text_color(t.foreground).track_focus(this.handle).key_context("MultiRootMenu")
      .on_key_down((event, cx) => {
        if ((event.key === "left" || event.key === "right") && entry) {
          const roots = this.roots.filter(f => f.exists), index = roots.findIndex(f => f.path === this.root);
          if (roots.length) this.root = roots[(index + (event.key === "right" ? 1 : roots.length - 1)) % roots.length].path;
          cx.stop_propagation(); cx.notify(); return;
        }
      })
      .when(entry?.folders.length >= 2, el => el.child(h_flex().px(4).py(5).gap(4).flex_wrap().children(this.roots.map(folder =>
        div().id(`choose-${folder.path}`).px(8).py(5).rounded(6).text_color(folder.exists ? t.foreground : t.dim)
          .when(this.root === folder.path, chip => chip.bg(t.selected)).when(folder.exists, chip => chip.cursor_pointer().hover(s => s.bg(t.hover)))
          .on_click((_event, cx) => { if (folder.exists) { this.root = folder.path; cx.notify(); } }).child(label(folder))))))
      .when(Boolean(this.error || entry?.error), el => el.child(div().px(9).py(4).text_size(12).text_color(t.ansi1).child(this.error || entry.error)))
      .child(this.row("terminal", svg("icons/shell.svg").size(14), "Terminal", () => this.start(), "⌘ T", enabled))
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().children(choices.map((agent, index) => this.row(`agent-${agent.key}`,
        agent.tint ? svg(agent.icon).size(14).text_color(t.foreground) : image(agent.icon).size(14), agent.name, () => this.start(agent),
        agent.installed ? index < 9 ? `⌘ ${index + 1}` : "" : "not installed", agent.installed && enabled)))
        .when(!choices.length, el => el.child(div().px(9).py(6).text_size(12).text_color(t.dim).child(this.failed ? "Could not load agents" : "Checking installed agents…"))))
      .child(divider())
      .when(Boolean(entry), el => el
        .child(this.row("add", div().w(14).child("+"), "Add folder…", () => this.dialog("add")))
        .child(this.row("save", div().w(14), entry?.file ? "Save workspace" : "Save workspace…", () => this.dialog("save"))))
      .when(!entry, el => el.child(this.row("make", div().w(14).child("+"), "Make this space a workspace", () => this.makeWorkspace(), "", Boolean(this.spaceId))))
      .child(this.row("open", div().w(14), "Open workspace…", () => this.dialog()));
    menu.on_action("MultiRootTerminal", (_event, cx) => this.launch(null, cx));
    for (let i = 0; i < 9; i++) menu.on_action(`MultiRootAgent${i + 1}`, (_event, cx) => { if (installed[i]) this.launch(installed[i], cx); });
    return menu;
  }

  renderRootMenu() {
    const entry = workspaceOf(this.spaceId);
    return v_flex().bg(theme().popover).p(5).text_size(13)
      .child(this.row("new-here", div().w(14).child("+"), "New terminal or agent here…", () => openOverlay({ mod: "multi-root", kind: "popup", width: 280, height: 420, props: { space: this.spaceId, root: props()?.root } })))
      .child(this.row("remove-root", div().w(14).child("−"), "Remove from workspace", () => this.dialog("remove", { root: props()?.root }), "", entry?.folders.length > 1));
  }

  renderRepoMenu() {
    const t = theme(), selected = shared(REPO)?.[this.spaceId]?.root;
    return v_flex().bg(t.popover).p(5).text_size(13).max_h(300).overflow_y_scrollbar()
      .children(this.repos.map(folder => this.row(`repo-${folder.path}`, div().w(14).child(folder.top === selected ? "✓" : ""), label(folder),
        () => putShared(REPO, { ...(shared(REPO) || {}), [this.spaceId]: { root: folder.top, by: "pick" } }),
        folder.top ? `${folder.branch}  ${folder.count}` : "Not a git repository", Boolean(folder.top))))
      .when(Boolean(this.error), el => el.child(div().p(9).text_size(12).text_color(t.ansi1).child(this.error)));
  }

  renderOpen() {
    const t = theme();
    const fileRow = (file, name, missing) => h_flex().id(`open-${file}`).px(10).py(8).gap(8).rounded(7).items_center()
      .when(!missing, el => el.cursor_pointer().hover(s => s.bg(t.selected)))
      .on_click((_event, cx) => { if (!missing) this.openFile(file, cx); })
      .child(v_flex().flex_1().min_w(0).gap(3)
        .child(div().text_color(missing ? t.dim : t.foreground).child(name))
        .child(div().text_size(12).text_color(t.dim).truncate().child(shortPath(file))))
      .when(missing, el => el.child(div().text_size(12).text_color(t.dim).child("Not found")));
    return v_flex().w_full().h_full().min_h(0).p(16).gap(10).bg(t.popover).text_size(13).text_color(t.foreground)
      .child(div().font_semibold().child(props()?.action === "add" ? "Add folder…" : props()?.action === "save" ? "Save workspace" : props()?.action === "remove" ? "Remove from workspace" : "Open workspace…"))
      .when(Boolean(this.error), el => el.child(div().text_size(12).text_color(t.ansi1).child(this.error)))
      .when(!props()?.action, el => el
        .child(div().id("choose-folder").h(32).px(10).rounded(7).bg(t.raised).cursor_pointer().on_click((_event, cx) => this.chooseFolder(cx)).child("Choose folder…"))
        .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar()
          .when(this.chosen, list => list.children(this.files.map(file => fileRow(file, basename(file).replace(/\.herdr-workspace\.json$/, ""), false)))
            .when(!this.files.length, item => item.child(div().p(10).text_color(t.dim).child("No workspace files in this folder"))))
          .when(Boolean(this.recent.length), list => list.child(div().px(10).py(6).text_color(t.muted).child("Recent")).children(this.recent.map(item => fileRow(item.file, item.name, item.missing))))));
  }

  render() {
    if (this.opening) {
      const pending = this.opening, created = spaces().find(s => !pending.before.includes(s.id) && s.name === pending.name);
      if (created) {
        setWorkspace(created.id, { name: pending.snapshot.name, file: pending.file, folders: pending.snapshot.folders });
        remember(pending.file); this.opening = null;
        closeOverlay(props()?.overlay); run("space.rename", { id: created.id, name: pending.snapshot.name });
      }
    }
    if (this.role === "root-menu") return this.renderRootMenu();
    if (this.role === "repo-menu") return this.renderRepoMenu();
    if (this.role === "open") return this.renderOpen();
    return this.renderNew();
  }
}
