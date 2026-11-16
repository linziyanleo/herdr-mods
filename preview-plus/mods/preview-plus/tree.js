// Directory enumeration and bounds adapted from Herdr's Apache-2.0 Files mod.
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, watchFolder, window } from "herdr";
import { join, normalize } from "./paths.js";

const PER_FOLDER = 500, TOTAL = 5000;

async function directory(path, on) {
  if (!on && window()?.platform === "windows") {
    const command = "& { param($p) @(Get-ChildItem -LiteralPath $p -Force -ErrorAction Stop | Where-Object Name -ne '.git' | Select-Object -First 501 | ForEach-Object { @{ name=$_.Name; dir=($_.PSIsContainer -and -not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint)) } }) | ConvertTo-Json -Compress } '" + path.replaceAll("'", "''") + "'";
    const result = await exec("powershell", ["-NoProfile", "-Command", command]);
    if (result.code !== 0) throw new Error(result.stderr || "Cannot list this folder");
    const entries = JSON.parse(result.stdout || "[]");
    return Array.isArray(entries) ? entries : [entries];
  }
  const script = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; [ "$name" = .git ] && continue; if [ -d "$p" ] && [ ! -L "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt 500 ] && break; done; test -d "$1"';
  const result = await exec("sh", ["-c", script, "preview-plus", path], { on });
  if (result.code !== 0) throw new Error(result.stderr || "Cannot list this folder");
  const fields = result.stdout.split("\0"), entries = [];
  for (let i = 0; i + 1 < fields.length; i += 2) entries.push({ name: fields[i + 1], dir: fields[i] === "d" });
  return entries;
}

export class Tree {
  constructor(location, current) {
    this.location = location; this.current = current;
    this.entries = new Map(); this.folders = new Set(); this.pending = new Map();
    this.requests = new Map(); this.generation = 0;
    this.loading = false; this.error = null; this.limited = false; this.marks = {};
  }

  async load(path) {
    const request = {}; this.requests.set(path, request);
    let entries;
    try { entries = await directory(join(this.location.cwd, path), this.location.on); }
    catch (error) { if (this.requests.get(path) === request && this.current()) throw error; return; }
    if (this.requests.get(path) !== request || !this.current() || (path && !this.folders.has(path))) return;
    const used = [...this.entries].filter(([p]) => p !== path).reduce((n, [, values]) => n + values.length, 0);
    this.entries.set(path, entries.slice(0, Math.max(0, Math.min(PER_FOLDER, TOTAL - used))).sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name)));
    if (entries.length > PER_FOLDER || used + entries.length > TOTAL) this.limited = true;
  }

  refresh(cx) {
    if (!this.location.cwd || this.loading || !this.current()) return;
    this.loading = true; this.limited = false;
    const generation = this.generation;
    cx.spawn(async cx => {
      try {
        for (const path of ["", ...this.folders]) {
          if (!this.current() || this.generation !== generation) return;
          // A removed expanded folder must not prevent the rest of the tree reloading.
          try { await this.load(path); }
          catch (error) { if (!path) throw error; this.entries.delete(path); }
        }
        const options = { cwd: this.location.cwd, on: this.location.on };
        const top = await exec("git", ["rev-parse", "--show-toplevel"], options).catch(() => null);
        const marks = {};
        if (top?.code === 0) {
          const status = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=normal"], options).catch(() => null);
          if (status?.code === 0) for (const entry of status.stdout.split("\0").filter(Boolean).slice(0, TOTAL)) {
            const xy = entry.slice(0, 2);
            marks[join(top.stdout.trim(), entry.slice(3))] = xy === "??" || xy.includes("A") ? "A" : xy.includes("D") ? "D" : xy.includes("U") ? "U" : "M";
          }
        }
        if (this.current() && this.generation === generation) { this.marks = marks; this.error = null; }
      } catch (error) { if (this.current() && this.generation === generation) this.error = String(error.message || error); }
      finally {
        if (this.current() && this.generation === generation) {
          this.loading = false;
          if (this.dirty) { this.dirty = false; this.refresh(cx); }
          cx.notify();
        }
      }
    });
  }

  watch(cx) {
    if (this.location.on || !this.location.cwd || this.watching) return;
    const token = this.watching = {};
    cx.spawn(async cx => {
      try {
        while (this.watching === token && this.current()) {
          token.pending = watchFolder(this.location.cwd);
          const paths = await token.pending;
          if (this.watching !== token || !this.current() || !paths.length) return;
          if (this.loading) this.dirty = true; else this.refresh(cx);
        }
      } catch (error) {
        if (this.current()) { this.error = `Live refresh unavailable: ${String(error.message || error)}`; cx.notify(); }
      } finally {
        token.pending?.cancel();
        if (this.watching === token) this.watching = null;
      }
    });
  }

  close() { this.watching?.pending?.cancel(); this.watching = null; this.generation++; this.requests.clear(); this.pending.clear(); this.loading = false; this.dirty = false; }

  toggle(path, cx) {
    if (this.folders.has(path)) {
      for (const folder of [...this.folders]) if (folder === path || folder.startsWith(path + "/")) { this.folders.delete(folder); this.entries.delete(folder); this.requests.delete(folder); this.pending.delete(folder); }
    } else {
      this.folders.add(path);
      if (!this.entries.has(path) && !this.pending.has(path)) {
        const token = {}, generation = this.generation;
        this.pending.set(path, token);
        cx.spawn(async cx => {
          try { await this.load(path); }
          catch (error) { if (this.current() && this.generation === generation && this.pending.get(path) === token) this.error = String(error.message || error); }
          finally {
            if (this.pending.get(path) === token) this.pending.delete(path);
            if (this.current() && this.generation === generation) cx.notify();
          }
        });
      }
    }
    cx.notify();
  }

  rows(prefix, depth, out, colors, openFile) {
    if (depth > 40) return out;
    for (const entry of this.entries.get(prefix) || []) {
      if (out.length >= TOTAL) break;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name, open = this.folders.has(path), mark = this.marks[normalize(join(this.location.cwd, path))];
      out.push(h_flex().id(`preview-file-${path}`).h(28).flex_none().pl(8 + depth * 18).pr(8).gap(7).items_center().rounded(7).cursor_default().hover(s => s.bg(colors.hover))
        .on_click((_event, cx) => entry.dir ? this.toggle(path, cx) : openFile({ file: join(this.location.cwd, path), root: this.location.cwd, on: this.location.on }, cx))
        .child(div().w(12).flex_none().text_color(colors.muted).child(entry.dir ? open ? "⌄" : "›" : ""))
        .child(div().flex_1().min_w(0).truncate().text_color(colors.foreground).child(entry.name))
        .when(Boolean(mark), el => el.child(div().text_size(12).text_color(mark === "A" ? colors.ansi2 : mark === "D" || mark === "U" ? colors.ansi1 : colors.ansi3).child(mark))));
      if (entry.dir && open) this.rows(path, depth + 1, out, colors, openFile);
    }
    return out;
  }

  render(colors, openFile) {
    return v_flex().id("preview-tree").flex_1().min_h(0).overflow_y_scrollbar().p(6).children(this.rows("", 0, [], colors, openFile))
      .when(Boolean(this.error) || !this.entries.get("")?.length, el => el.child(div().p(16).text_size(12).text_color(colors.muted).child(this.error || (this.loading ? "Loading files…" : this.location.cwd ? "No files" : "No folder"))))
      .when(this.limited, el => el.child(div().p(16).text_size(12).text_color(colors.muted).child("File list limited to 500 entries per folder and 5,000 total.")));
  }
}
