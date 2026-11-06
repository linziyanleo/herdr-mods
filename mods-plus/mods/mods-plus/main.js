// Mods Plus: Browse, install, enable, update, and remove community Herdr mods and layouts.
// All package operations are handled through helper.py with validation and protection.

import { View, div, image, svg } from "gpui-kit";
import { h_flex, v_flex, Input, InputState, TextView, Select, Popup, Switch } from "gpui-base";
import { exec, appHome, props, closeOverlay, notify, theme, window, run, knownAgents, settings, layout, updates, shared, setShared } from "herdr";

const short = (sha) => (sha ? sha.slice(0, 7) : "?");
const opener = () => (window()?.platform === "macos" ? "open" : window()?.platform === "windows" ? "explorer" : "xdg-open");

export default class ModsPlus extends View {
  init(_props, cx) {
    this.entry = Boolean(props()?.entry);
    this.preparedCount = 0;
    this.checking = false;
    this.savingSettings = false;
    this.workDepth = 0;
    this.busy = null;
    this.message = null;

    if (this.entry) {
      // The footer owns scheduling while its layout is loaded.
      cx.spawn(cx => this.checkOverdue(cx));
      cx.timer.every(60 * 1000, (cx) => cx.spawn(cx => this.checkOverdue(cx)));
      return;
    }

    // Overlay dialog
    this.view = "catalog"; // "catalog" | "details" | "settings"
    this.tab = "mod"; // "mod" | "layout"
    this.filter = "all"; // "all" | "installed" | "not_installed"
    this.query = "";
    this.collection = "community";
    this.sort = "popular";
    this.limit = 24;
    this.width = 1000;
    this.media = {};
    this.loadingMedia = false;
    this.packages = [];
    this.selected = null;
    this.settings = null;
    this.confirmRemove = null;

    this.handle = cx.focus_handle();
    this.sortFocus = cx.focus_handle();
    this.sortListFocus = cx.focus_handle();
    this.search = InputState.new({ placeholder: "Search mods and layouts" });
    this.search.on("change", (_e, cx) => {
      this.query = this.search.value();
      this.limit = 24;
      this.loadMedia(cx);
      cx.notify();
    });
    this.initIntervalInput();
    this.handle.focus();

    cx.spawn(async (cx) => {
      await this.loadCatalog(cx);
      await this.loadSettings(cx);
      // Check if scheduled checks are overdue on opening
      if (this.settings?.overdue) {
        await this.runUpdateCheck(cx, false);
      }
    });
  }

  // -------------------------------- Helper execution --------------------------------

  async helper(args, cx) {
    const invoke = async (script, params) => {
      const res = await exec("python3", ["-B", `${appHome()}/mods/mods-plus/${script}`, "--app-home", appHome(), ...params]);
      if (res.code !== 0) throw new Error((res.stderr || res.stdout).trim().split("\n").pop() || "Helper operation failed");
      return JSON.parse(res.stdout);
    };
    try {
      if (args[0] === "settings") return await invoke("helper.py", ["--json", ...args]);
      let job = await invoke("jobs.py", ["start", JSON.stringify(args)]);
      while (job.state === "running") {
        await cx.sleep(500);
        job = await invoke("jobs.py", ["status", job.id]);
      }
      if (job.state === "failed") throw new Error(job.error);
      return job.result;
    } catch (error) {
      throw new Error(`${args[0]}: ${error.message || error}`);
    }
  }

  async work(cx, label, fn) {
    this.workDepth += 1;
    this.busy = label;
    this.message = null;
    cx.notify();
    try {
      await fn();
    } catch (e) {
      this.message = String(e?.message ?? e);
    }
    this.workDepth -= 1;
    if (!this.workDepth) this.busy = null;
    cx.notify();
  }

  // -------------------------------- Data loading --------------------------------

  async checkOverdue(cx) {
    if (this.checking) return;
    try {
      const s = await this.helper(["settings"], cx);
      this.acceptSettings(s);
      if (s.overdue) {
        await this.runUpdateCheck(cx, false);
      }
      cx.notify();
    } catch {
      // Background checks fail silently without throwing in UI
    }
  }

  async loadCatalog(cx) {
    await this.work(cx, "Loading catalog…", async () => {
      const cached = await this.helper(["catalog", "--cached"], cx);
      this.packages = cached.packages || [];
      this.message = (cached.warnings || []).join("\n") || null;
      cx.notify();
      this.loadMedia(cx);
      if (cached.stale) {
        const res = await this.helper(["catalog"], cx);
        this.packages = res.packages || [];
        this.message = (res.warnings || []).join("\n") || null;
      }
    });
    this.loadMedia(cx);
  }

  visiblePackages() {
    const query = this.query.trim().toLowerCase();
    return this.packages.filter(p =>
      p.kind === this.tab && p.collection === this.collection &&
      (this.filter === "all" || (this.filter === "installed" ? p.installed === true : p.installed === false)) &&
      `${p.name} ${p.author} ${p.description}`.toLowerCase().includes(query)
    ).sort((a, b) =>
      Number(b.installed === true) - Number(a.installed === true) ||
      Number(!a.preview_url) - Number(!b.preview_url) ||
      (this.sort === "new" ? b.pushed.localeCompare(a.pushed) : b.stars - a.stars) ||
      a.name.localeCompare(b.name));
  }

  loadMedia(cx) {
    if (this.loadingMedia) return;
    const ids = this.visiblePackages().slice(0, this.limit).filter(p => !this.media[p.id]).slice(0, 4).map(p => p.id);
    if (!ids.length) return;
    this.loadingMedia = true;
    cx.spawn(async (cx) => {
      try {
        const res = await this.helper(["media", JSON.stringify(ids)], cx);
        for (const item of res.media || []) this.media[item.id] = item;
        for (const id of ids) this.media[id] ||= { id };
      } catch (e) {
        for (const id of ids) this.media[id] = { id, error: String(e.message || e) };
      } finally {
        this.loadingMedia = false;
      }
      cx.notify();
      // A filter may have changed while the images were loading.
      this.loadMedia(cx);
    });
  }

  changeFilter(key, value, cx) {
    this[key] = value;
    this.limit = 24;
    this.loadMedia(cx);
    cx.notify();
  }

  async loadSettings(cx) {
    try {
      this.acceptSettings(await this.helper(["settings"], cx));
    } catch (e) {
      this.message = `Settings load error: ${e.message}`;
    }
    cx.notify();
  }

  acceptSettings(value) {
    this.settings = value;
    this.preparedCount = value.prepared_updates_count || 0;
    setShared("mods-plus.updates", { count: this.preparedCount });
    if (value.prepared_update_ids) {
      const ids = new Set(value.prepared_update_ids);
      this.packages = (this.packages || []).map(pkg => ({ ...pkg, has_update: ids.has(pkg.id) }));
      if (this.selected) this.selected.has_update = ids.has(this.selected.id);
    }
    if (this.intervalInput && !this.intervalDirty) {
      this.intervalUnit = value.interval_unit;
      const text = String(value.interval_value);
      if (this.intervalInput.value() !== text) this.intervalInput.set_value(text);
    }
  }

  initIntervalInput() {
    this.intervalUnit = "hr";
    this.intervalInput = InputState.new({ value: "24" });
    this.intervalInput.on("change", (_e, cx) => {
      this.intervalDirty = this.intervalChanged();
      this.intervalError = null;
      cx.notify();
    });
    this.intervalInput.on("blur", (_e, cx) => this.queueIntervalSave(cx));
    this.intervalInput.on("submit", (_e, cx) => this.queueIntervalSave(cx));
  }

  intervalChanged() {
    return this.intervalInput.value().trim() !== String(this.settings?.interval_value)
      || this.intervalUnit !== this.settings?.interval_unit;
  }

  queueIntervalSave(cx, unit = this.intervalUnit) {
    this.intervalUnit = unit;
    this.intervalDirty = this.intervalChanged();
    this.intervalSaveTask?.cancel();
    if (this.intervalDirty) {
      // Coalesce the input's blur with a click on its adjacent unit control.
      this.intervalSaveTask = cx.timer.after(250, cx => cx.spawn(cx => this.saveInterval(cx)));
    }
    cx.notify();
  }

  async saveInterval(cx) {
    if (this.savingSettings) { this.queueIntervalSave(cx); return; }
    const text = this.intervalInput.value().trim();
    const value = Number(text);
    if (!/^\d+$/.test(text) || !Number.isSafeInteger(value) || value < 1) {
      this.intervalError = "Enter a positive whole number.";
      cx.notify();
      return;
    }
    if (!this.intervalChanged()) return;
    const saved = await this.saveSettings(["--interval-value", String(value), "--interval-unit", this.intervalUnit], cx);
    if (saved) {
      this.intervalDirty = false;
      this.intervalError = null;
      this.acceptSettings(this.settings);
    }
    cx.notify();
  }

  async saveSettings(args, cx) {
    if (this.savingSettings || this.checking) return;
    this.savingSettings = true;
    let saved = false;
    await this.work(cx, "Saving settings…", async () => {
      this.acceptSettings(await this.helper(["settings", ...args], cx));
      saved = true;
    });
    this.savingSettings = false;
    cx.notify();
    if (saved && this.settings?.overdue) await this.runUpdateCheck(cx, false);
    return saved;
  }

  async showDetails(pkg, cx) {
    this.view = "details";
    this.selected = { ...pkg, ...this.media[pkg.id] };
    this.confirmRemove = null;
    cx.notify();
    await this.work(cx, `Loading details for ${pkg.name}…`, async () => {
      const details = await this.helper(["details", pkg.id], cx);
      if (this.selected?.id === pkg.id) this.selected = details;
    });
  }

  // -------------------------------- Actions --------------------------------

  async installPackage(pkg, cx) {
    await this.work(cx, `Installing ${pkg.name}…`, async () => {
      const res = await this.helper(["install", pkg.repo, pkg.subdir || ""], cx);
      if (!res.ok) throw new Error(res.error || "Installation failed");
      notify({ title: "Installed", body: `${pkg.name} staged successfully. Use Enable to activate.`, level: "success" });
      await this.showDetails(pkg, cx);
      await this.loadCatalog(cx);
    });
  }

  async enablePackage(pkg, cx) {
    await this.work(cx, `Enabling ${pkg.name}…`, async () => {
      const res = await this.helper(["enable", pkg.id], cx);
      if (!res.ok) throw new Error(res.error || "Failed to enable mod");
      notify({ title: "Enabled", body: `Enabled mod ${pkg.name}.`, level: "success" });
      await this.showDetails(pkg, cx);
      await this.loadCatalog(cx);
    });
  }

  async useLayout(pkg, cx) {
    await this.work(cx, `Applying layout ${pkg.name}…`, async () => {
      const res = await this.helper(["use-layout", pkg.id], cx);
      if (!res.ok) throw new Error(res.error || "Failed to switch layout");
      notify({ title: "Layout Activated", body: `Switched to layout ${res.layout}.`, level: "success" });
      await this.showDetails(pkg, cx);
      await this.loadCatalog(cx);
    });
  }

  async removePackage(pkg, cx) {
    if (this.confirmRemove !== pkg.id) {
      this.confirmRemove = pkg.id;
      cx.notify();
      return;
    }
    this.confirmRemove = null;
    await this.work(cx, `Removing ${pkg.name}…`, async () => {
      const res = await this.helper(["remove", pkg.id], cx);
      if (!res.ok) {
        throw new Error(res.error || "Could not remove package");
      }
      notify({ title: "Removed", body: `${pkg.name} removed. Backup retained in data/mods-plus/backups/`, level: "success" });
      this.view = "catalog";
      await this.loadCatalog(cx);
      await this.loadSettings(cx);
    });
  }

  async runUpdateCheck(cx, userInitiated = true) {
    if (this.checking) return;
    this.checking = true;
    await this.work(cx, "Checking for updates…", async () => {
      const res = await this.helper(userInitiated ? ["check-updates"] : ["check-updates", "--if-overdue"], cx);
      this.acceptSettings(res.settings);
      if (!this.entry) {
        const summary = res.count > 0 ? `${res.count} update(s) available.` : "All installed packages are up to date.";
        const result = res.errors?.length
          ? `Could not check ${res.errors.length} package(s). ${res.errors.map(e => `${e.id}: ${e.error}`).join("\n")}`
          : summary;
        this.message = result;
      }
    });
    this.checking = false;
    cx.notify();
  }

  async applyUpdate(pkg, cx) {
    await this.work(cx, `Updating ${pkg.name}…`, async () => {
      const res = await this.helper(["apply-update", pkg.id], cx);
      if (!res.ok) throw new Error(res.error || "Failed to apply update");
      notify({ title: "Updated", body: `${pkg.name} updated.`, level: "success" });
      await this.showDetails(pkg, cx);
      await this.loadCatalog(cx);
      await this.loadSettings(cx);
    });
  }

  async copyActivationPrompt(pkg, cx) {
    await this.work(cx, "Copying prompt…", async () => {
      const res = await this.helper(["copy-prompt", pkg.id, "--catalog"], cx);
      if (res.ok) {
        this.message = "Prompt copied to clipboard.";
      } else {
        throw new Error("Failed to copy to clipboard.");
      }
    });
  }

  async openAgentTab(pkg, cx) {
    await this.work(cx, "Launching agent…", async () => {
      let agentCli = this.settings?.default_agent;
      if (!agentCli) {
        try {
          const agents = await knownAgents();
          agentCli = agents?.[0]?.command || agents?.[0]?.name || "codex";
        } catch {
          agentCli = "codex";
        }
      }
      const details = this.selected || await this.helper(["details", pkg.id], cx);
      const promptText = details.prompt;

      run("tab.new", {
        name: `Activate ${pkg.name}`,
        argv: [agentCli],
        task: promptText,
      });

      this.message = `Started agent tab with ${agentCli}.`;
    });
  }

  openUrl(url) {
    exec(opener(), [url]).catch(() => {});
  }

  // -------------------------------- UI Components --------------------------------

  button(t, id, label, action, options = {}) {
    const { primary = false, destructive = false, disabled = false } = options;
    return div()
      .id(id)
      .role("button")
      .cursor_pointer()
      .px(10)
      .h(26)
      .flex()
      .items_center()
      .justify_center()
      .rounded(6)
      .flex_none()
      .text_size(12)
      .border(0.5)
      .border_color(primary ? t.accent : destructive ? t.blocked : t.border)
      .when(primary, (el) => el.bg(t.accent).text_color(t.accent_foreground).font_medium())
      .when(destructive, (el) => el.bg(t.blocked).text_color(t.background).font_medium())
      .when(!primary && !destructive, (el) =>
        el.bg(t.background).text_color(t.foreground).hover((s) => s.bg(t.hover))
      )
      .when(disabled, (el) => el.opacity(0.5).cursor_default())
      .when(!disabled, el => el.active(s => s.opacity(0.7)))
      .transition("opacity", { duration: 250, easing: "ease-out" })
      .on_click((_e, cx) => {
        cx.stop_propagation();
        if (!disabled) {
          action(cx);
        }
      })
      .child(label);
  }

  tabPill(t, id, label, active, action) {
    return div()
      .id(id)
      .role("button")
      .accessibility_label(label)
      .px(11)
      .h(26)
      .flex()
      .items_center()
      .rounded(6)
      .text_size(12)
      .cursor_pointer()
      .when(active, (el) => el.bg(t.selected).text_color(t.foreground).font_medium())
      .when(!active, (el) => el.text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground)))
      .on_click((_e, cx) => action(cx))
      .child(label);
  }

  // -------------------------------- Entry View --------------------------------

  renderEntry(t) {
    const count = Number(shared("mods-plus.updates")?.count) || 0;
    if (props()?.footer) {
      const nodes = [layout()];
      let collapsed = false;
      while (nodes.length) {
        const node = nodes.pop();
        if (node?.id === "sidebar") {
          collapsed = (node.size?.px ?? Infinity) < 160;
          break;
        }
        nodes.push(...(node?.children ?? []));
      }
      const row = (id, icon, label, dim, action, badge = false) =>
        h_flex().id(id).role("button").accessibility_label(label).h(28).px(8).gap(9)
          .items_center().rounded(8).text_color(dim ? t.dim : t.muted)
          .hover(s => s.bg(t.hover).text_color(t.foreground)).cursor_pointer().tooltip(label)
          .on_click(action)
          .when(!(collapsed && id === "plugins" && badge), el => el.child(this.icon(icon, 14)))
          .when(!collapsed, el => el.child(label).child(div().flex_1()))
          .when(id === "plugins" && this.checking && !collapsed, el => el.child(this.spinner()))
          .when(Boolean(badge), el => el.child(typeof badge === "number"
            ? this.updateBadge(t, badge)
            : div().size(6).rounded_full().bg(t.accent)));
      return v_flex().size_full().bg(t.chrome).border_t(0.5).border_color(t.border)
        .px(8).pt(4).pb(8).text_size(13)
        .child(row("plugins", "layers", "Plugins", false,
          () => run("mod.open", { name: "mods-plus" }), count))
        .child(row("settings", "settings", "Settings", false,
          () => run("app.settings"), Boolean(updates().app.ready)))
        .child(row("machine", "plus", "Add machine", true,
          () => run("mod.open", { name: "machine-add" })));
    }
    return h_flex()
      .id("plugins-entry-btn")
      .size_full()
      .items_center()
      .justify_center()
      .child(
        div()
          .id("plugins-btn")
          .size(26)
          .flex_none()
          .flex()
          .items_center()
          .justify_center()
          .rounded(6)
          .text_color(t.muted)
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .cursor_pointer()
          .tooltip("Plugins")
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click(() => run("mod.open", { name: "mods-plus" }))
          .child(this.icon("layers", 16))
          .when(count > 0, el => el.child(this.updateBadge(t, count)))
      );
  }

  // -------------------------------- Catalog View --------------------------------

  icon(name, size = 16) {
    return svg(`mods/workspace-chrome/${name}.svg`).size(size).flex_none();
  }

  spinner() {
    return this.icon("spinner", 14).spin(900);
  }

  updateBadge(t, count) {
    return div().min_w(12).h(12).px(2).flex_none().rounded_full().flex().items_center().justify_center()
      .text_size(8).font_medium().bg(t.accent).text_color(t.accent_foreground)
      .child(String(count));
  }

  iconButton(t, id, name, label, action) {
    return div().id(id).role("button").accessibility_label(label).size(32).flex_none().flex().items_center().justify_center()
      .rounded(6).text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
      .cursor_pointer().tooltip(label).on_click((_e, cx) => action(cx)).child(this.icon(name));
  }

  avatar(t, pkg) {
    const avatar = pkg.avatar_path || this.media[pkg.id]?.avatar_path;
    return avatar ? image(avatar).size(32).rounded(7).flex_none() :
      div().size(32).rounded(7).bg(t.selected).flex().items_center().justify_center().child(pkg.author.slice(0, 1));
  }

  author(t, pkg) {
    return h_flex().gap(10).items_center().min_w(0)
      .child(this.avatar(t, pkg))
      .child(div().text_size(12).text_color(t.muted).truncate().child(pkg.author));
  }

  stars(t, pkg) {
    return h_flex().gap(4).flex_none().items_center().text_color(t.muted)
      .child(svg("mods/mods-plus/star.svg").size(14)).child(String(pkg.stars || 0));
  }

  preview(t, pkg, width, height, contain = false) {
    const asset = pkg.preview_path ? pkg : this.media[pkg.id];
    let picture;
    if (asset?.preview_path) {
      const iw = asset.preview_width || width, ih = asset.preview_height || height;
      const scale = contain ? Math.min(width / iw, height / ih) : Math.max(width / iw, height / ih);
      picture = image(asset.preview_path).w(iw * scale).h(ih * scale).flex_none();
    } else {
      picture = div().p(20).text_size(12).text_color(t.muted)
        .when(Boolean(pkg.preview_url && !asset), el => el.child(this.spinner()))
        .child(pkg.preview_url ? (asset ? "Preview unavailable" : "Loading preview…") : pkg.description);
    }
    return div().w(width).h(height).flex_none().overflow_hidden().bg(t.background)
      .flex().items_center().justify_center().child(picture);
  }

  sortPicker(t) {
    const options = [["popular", "Popular"], ["new", "Newest"]];
    const choose = (key, cx) => {
      this.sortOpen = false;
      this.changeFilter("sort", key, cx);
      this.sortFocus.focus();
    };
    const trigger = this.button(t, "sort", h_flex().gap(8).items_center()
      .child(this.sort === "popular" ? "Popular" : "Newest").child(this.icon("chevron-down", 12)),
      cx => { this.sortOpen = !this.sortOpen; this.sortHighlight = this.sort === "new" ? 1 : 0; cx.notify(); });
    const list = v_flex().w(124).p(4).gap(2).bg(t.popover).border(0.5).border_color(t.border).rounded(6)
      .track_focus(this.sortListFocus)
      .on_key_down((e, cx) => {
        const key = e.key.toLowerCase();
        if (key === "up" || key === "down") {
          this.sortHighlight = this.sortHighlight === 1 ? 0 : 1;
        } else if (key === "enter") {
          choose(options[this.sortHighlight || 0][0], cx);
        } else if (key === "escape") {
          this.sortOpen = false; this.sortFocus.focus();
        } else return;
        cx.stop_propagation(); cx.notify();
      })
      .children(options.map(([key, label], index) => this.tabPill(t, "sort-" + key, label,
        index === (this.sortHighlight || 0), cx => choose(key, cx)).role("list_box_option")));
    return Select.new("catalog-sort").accessibility_label("Sort packages")
      .open(Boolean(this.sortOpen)).track_focus(this.sortFocus).content_focus_handle(this.sortListFocus)
      .on_open_change((open, cx) => { this.sortOpen = open; this.sortHighlight = this.sort === "new" ? 1 : 0; cx.notify(); })
      .child(Popup.new("sort-popup", trigger).anchor("top_right").when(this.sortOpen, el => el.content(list)));
  }

  renderCatalog(t) {
    const packages = this.visiblePackages();
    const columns = Math.max(1, Math.min(3, Math.floor((this.width - 32) / 280)));
    const cardWidth = (this.width - 32 - (columns - 1) * 16) / columns;
    const counts = collection => this.packages.filter(p => p.kind === this.tab && p.collection === collection).length;
    const controls = h_flex().w_full().gap(8).items_center().flex_wrap()
      .child(this.tabPill(t, "tab-mod", "Mods", this.tab === "mod", cx => this.changeFilter("tab", "mod", cx)))
      .child(this.tabPill(t, "tab-layout", "Layouts", this.tab === "layout", cx => this.changeFilter("tab", "layout", cx)))
      .child(div().flex_1())
      .children([["all", "All"], ["installed", "Installed"], ["not_installed", "Not installed"]].map(([key, label]) =>
        this.tabPill(t, "filter-" + key, label, this.filter === key, cx => this.changeFilter("filter", key, cx))));
    const galleryBar = h_flex().w_full().gap(8).items_center().flex_wrap().pb(12).border_b(0.5).border_color(t.border)
      .child(this.tabPill(t, "community", `Community  ${counts("community")}`, this.collection === "community", cx => this.changeFilter("collection", "community", cx)))
      .child(this.tabPill(t, "examples", `Examples  ${counts("example")}`, this.collection === "example", cx => this.changeFilter("collection", "example", cx)))
      .child(div().flex_1())
      .child(this.iconButton(t, "settings", "settings", "Settings", cx => {
        this.view = "settings"; cx.spawn(cx => this.loadSettings(cx)); cx.notify();
      }))
      .child(h_flex().w(Math.min(220, this.width * 0.22)).h(32).px(8).gap(6).items_center()
        .rounded(6).border(0.5).border_color(t.border)
        .child(this.icon("search", 14)).child(Input.new(this.search).text_size(12)))
      .child(this.sortPicker(t));
    const rows = [];
    const shown = packages.slice(0, this.limit);
    for (let i = 0; i < shown.length; i += columns) {
      rows.push(h_flex().gap(16).flex_none().items_start()
        .children(shown.slice(i, i + columns).map(pkg => this.renderCard(t, pkg, cardWidth))));
    }
    const scroll = v_flex().id("catalog-scroll").flex_1().min_h(0).gap(16).overflow_y_scrollbar()
      .children(rows)
      .when(!packages.length && !this.busy, el => el.child(div().py(32).text_color(t.muted).child("No packages found.")))
      .when(packages.length > this.limit, el => el.child(this.button(t, "more", "Show more", cx => {
        this.limit += 24; this.loadMedia(cx); cx.notify();
      })));
    return [controls, galleryBar, scroll];
  }

  renderCard(t, pkg, width) {
    return v_flex().id("pkg-" + pkg.id).w(width).flex_none().rounded(12).overflow_hidden()
      .bg(t.chrome).border(0.5).border_color(t.border)
      .hover(s => s.bg(t.hover)).cursor_pointer()
      .on_click((_e, cx) => cx.spawn(cx => this.showDetails(pkg, cx)))
      .child(this.preview(t, pkg, width, width * 0.625))
      .child(h_flex().w_full().p(14).gap(10).items_center()
        .child(this.avatar(t, pkg))
        .child(v_flex().flex_1().min_w(0).gap(6)
          .child(div().text_size(16).truncate().child(pkg.name))
          .child(div().text_size(12).text_color(t.muted).truncate().child(pkg.author)))
        .child(v_flex().flex_none().gap(8).items_end().text_size(12)
          .child(this.stars(t, pkg))
          .when(pkg.installed === true || pkg.has_update, el => el.child(div()
            .text_color(pkg.has_update ? t.accent : t.muted).child(pkg.has_update ? "Update Available" : "Installed")))));
  }

  renderDetails(t) {
    const pkg = this.selected;
    if (!pkg) return [div().child("Loading details…")];
    const preview = pkg.preview_path || this.media[pkg.id]?.preview_path;
    const actions = h_flex().gap(8).flex_wrap()
      .when(pkg.installed === false && !pkg.collision, el => el.child(this.button(t, "install", "Install",
        cx => cx.spawn(cx => this.installPackage(pkg, cx)), {primary: true, disabled: Boolean(this.busy)})))
      .when(pkg.installed && pkg.kind === "mod" && !pkg.enabled, el => el.child(this.button(t, "enable", "Enable",
        cx => cx.spawn(cx => this.enablePackage(pkg, cx)), {primary: true, disabled: Boolean(this.busy)})))
      .when(pkg.installed && pkg.kind === "layout", el => el.child(this.button(t, "use", "Use layout",
        cx => cx.spawn(cx => this.useLayout(pkg, cx)), {primary: true, disabled: Boolean(this.busy)})));
    const titleActions = h_flex().gap(8).flex_none()
      .when(pkg.has_update, el => el.child(this.button(t, "update", "Apply update",
        cx => cx.spawn(cx => this.applyUpdate(pkg, cx)), {primary: true, disabled: Boolean(this.busy)})))
      .when(pkg.installed, el => el.child(this.button(t, "remove",
        this.confirmRemove === pkg.id ? "Confirm removal" : "Remove",
        cx => cx.spawn(cx => this.removePackage(pkg, cx)), {
          primary: this.confirmRemove !== pkg.id, disabled: Boolean(this.busy), destructive: this.confirmRemove === pkg.id,
        })));
    const summary = v_flex().flex_1().min_w(0).gap(16)
      .child(h_flex().gap(12).items_center().flex_wrap()
        .child(div().min_w(0).text_size(28).font_medium().child(pkg.name))
        .when(pkg.has_update || pkg.installed, el => el.child(titleActions)))
      .child(h_flex().gap(16).items_center().child(this.author(t, pkg)).child(this.stars(t, pkg)))
      .child(div().text_size(16).text_color(t.muted).child(pkg.description))
      .when((pkg.installed === false && !pkg.collision)
        || (pkg.installed && (pkg.kind === "layout" || (pkg.kind === "mod" && !pkg.enabled))), el => el.child(actions));
    const prompt = v_flex().flex_1().min_w(0).gap(12)
      .child(v_flex().p(18).gap(16).rounded(12).border(0.5).border_color(t.border)
        .child(h_flex().items_center().justify_between().child(div().text_color(t.muted).child("Tell your agent"))
          .child(this.button(t, "copy", "Copy", cx => cx.spawn(cx => this.copyActivationPrompt(pkg, cx)), {disabled: Boolean(this.busy)})))
        .child(div().text_size(12).child(pkg.install_prompt)))
      .child(h_flex().gap(8).flex_wrap()
        .child(this.button(t, "github", "View on GitHub", () => this.openUrl(pkg.source_url)))
        .child(this.button(t, "agent", "Open Agent tab", cx => cx.spawn(cx => this.openAgentTab(pkg, cx)), {disabled: Boolean(this.busy)})));
    const body = v_flex().id("details-scroll").flex_1().min_h(0).gap(24).overflow_y_scrollbar()
      .when(Boolean(preview), el => el.child(this.preview(t, pkg, this.width - 32,
        Math.min(440, (this.width - 32) * 0.46), true).rounded(12)))
      .child((this.width > 760 ? h_flex() : v_flex()).gap(24).flex_none().child(summary).child(prompt))
      .when(Boolean(pkg.collision), el => el.child(div().text_color(t.muted).child(pkg.collision)))
      .when(Boolean(pkg.recipe), el => el.child(v_flex().gap(12).flex_none()
        .child(div().text_size(16).child("Recipe"))
        .child(TextView.markdown("recipe-" + pkg.id, pkg.recipe).text_size(12))));
    return [
      h_flex().gap(8).items_center()
        .child(this.iconButton(t, "back", "chevron-left", "Back to catalog", cx => { this.view = "catalog"; cx.notify(); }))
        .child(div().text_color(t.muted).child(`${pkg.kind === "layout" ? "layouts" : "mods"} / ${pkg.author}`)),
      body,
    ];
  }

  // -------------------------------- Settings View --------------------------------

  renderSettings(t) {
    const s = this.settings || {};
    const auto = Boolean(s.auto_update);
    const disabled = !this.settings || this.savingSettings || this.checking;
    const count = Number(shared("mods-plus.updates")?.count) || 0;

    return [
      // Settings Header
      h_flex()
        .gap(10)
        .items_center()
        .child(
          this.button(t, "btn-back-settings", this.icon("chevron-left", 14), (cx) => {
            this.view = "catalog";
            cx.notify();
          }).accessibility_label("Back").tooltip("Back")
        )
        .child(div().font_semibold().text_size(16).text_color(t.foreground).child("Settings")),

      // Settings Cards
      v_flex()
        .id("settings-scroll")
        .flex_1()
        .min_h(0)
        .gap(12)
        .overflow_y_scrollbar()
        // Auto update toggle
        .child(
          h_flex()
            .p(14)
            .justify_between()
            .items_center()
            .rounded(8)
            .bg(t.chrome)
            .border(0.5)
            .border_color(t.border)
            .child(
              v_flex()
                .gap(2)
                .child(div().font_semibold().text_size(13).text_color(t.foreground).child("Automatic update checks"))
                .child(
                  div()
                    .text_size(12)
                    .text_color(t.muted)
                    .child("Download and verify candidates in the background. Active mods remain intact until applied.")
                )
            )
            .child(
              Switch.new("btn-toggle-auto").accessibility_label("Automatic update checks")
                .checked(auto).disabled(disabled || Boolean(this.intervalDirty))
                .w(38).h(22).flex_none().relative().rounded(11).border(0.5)
                .border_color(auto ? t.accent : t.border).bg(auto ? t.accent : t.background)
                .cursor_pointer().when(disabled || this.intervalDirty, el => el.opacity(0.5).cursor_default())
                .on_change((checked, cx) => cx.spawn(cx => this.saveSettings(["--auto-update", String(checked)], cx)))
                .child(div().id("auto-update-thumb").absolute().top(3).left(auto ? 19 : 3)
                  .size(16).rounded_full().bg(auto ? t.accent_foreground : t.foreground)
                  .transition("left", { duration: 250, easing: "ease-out" }))
            )
        )
        // Interval selector
        .child(
          h_flex()
            .p(14)
            .justify_between()
            .items_center()
            .rounded(8)
            .bg(t.chrome)
            .border(0.5)
            .border_color(t.border)
            .child(
              v_flex()
                .gap(2)
                .child(div().font_semibold().text_size(13).text_color(t.foreground).child("Check interval"))
                .child(
                  div().text_size(12).text_color(t.muted).child("How frequently Mods Plus checks for upstream updates while Herdr is running.")
                )
            )
            .child(
              v_flex().gap(4).items_end()
                .child(h_flex().gap(6).items_center()
                  .child(Input.new(this.intervalInput).id("check-interval-value")
                    .accessibility_label("Check interval").disabled(disabled)
                    .w(72).h(28).px(8).text_size(12).rounded(6).bg(t.background)
                    .border(0.5).border_color(this.intervalError ? t.blocked : t.border))
                  .children(["min", "hr"].map(unit => this.button(t, `interval-${unit}`, unit,
                    cx => this.queueIntervalSave(cx, unit), { primary: this.intervalUnit === unit, disabled }))))
                .when(Boolean(this.intervalError), el => el.child(div().text_size(12).text_color(t.blocked).child(this.intervalError)))
            )
        )
        // Manual Check and Prepared Updates
        .child(
          h_flex()
            .p(14)
            .justify_between()
            .items_center()
            .rounded(8)
            .bg(t.chrome)
            .border(0.5)
            .border_color(t.border)
            .child(
              v_flex()
                .gap(2)
                .child(div().font_semibold().text_size(13).text_color(t.foreground).child("Manual check"))
                .child(
                  div()
                    .text_size(12)
                    .text_color(t.muted)
                    .child(
                      count > 0
                        ? `${count} update candidate(s) prepared and verified.`
                        : "Check upstream repositories immediately for newer releases."
                    )
                )
            )
            .child(
              h_flex()
                .gap(6)
                .child(
                  this.button(t, "btn-check-now",
                    this.checking ? h_flex().gap(6).items_center().child(this.spinner()).child("Checking…") : "Check now",
                    cx => cx.spawn(cx => this.runUpdateCheck(cx, true)), { disabled: disabled || Boolean(this.intervalDirty) })
                )
            )
        ),
    ];
  }

  // -------------------------------- Main Render --------------------------------

  render(_cx) {
    const t = theme();
    if (this.entry) {
      return this.renderEntry(t);
    }

    const content =
      this.view === "details"
        ? this.renderDetails(t)
        : this.view === "settings"
        ? this.renderSettings(t)
        : this.renderCatalog(t);

    return v_flex()
      .id("mods-plus-root")
      .text_size(12)
      .on_size_change((size, cx) => {
        const width = size.width / (Number(settings().zoom) || 1);
        if (Math.abs(this.width - width) > 1) { this.width = width; cx.notify(); }
      })
      .track_focus(this.handle)
      .size_full()
      .p(16)
      .gap(12)
      .bg(t.canvas)
      .text_color(t.foreground)
      .on_key_down((e, cx) => {
        if (e.key === "escape") {
          if (this.view === "details" || this.view === "settings") {
            this.view = "catalog";
          } else if (props()?.overlay) {
            closeOverlay(props().overlay);
          }
          cx.stop_propagation();
          cx.notify();
        }
      })
      // Dialog Title Row
      .child(
        h_flex()
          .gap(6)
          .items_center()
          .child(div().text_size(16).font_semibold().pr(8).child("Plugins"))
          .child(div().flex_1())
          .child(
            div()
              .text_size(12)
              .text_color(t.dim)
              .child("Esc")
          )
      )
      .children(content)
      // Busy & Status message banner
      .when(Boolean(this.busy), (el) =>
        el.child(
          h_flex().gap(8).items_center().text_size(12).text_color(t.accent).child(this.spinner()).child(this.busy)
        )
      )
      .when(Boolean(this.message) && !this.busy, (el) =>
        el.child(
          div().text_size(12).text_color(t.muted).child(this.message)
        )
      );
  }
}
