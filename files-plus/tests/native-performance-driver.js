// Test-only owner: records real exec/row counts injected into the disposable build.
import FilesPlus from "./panel.js";
import { props, nextCommand, readTextFile, writeTextFile, spaces, setShared } from "herdr";
import { div } from "gpui-kit";
import { fps_monitor } from "gpui-fps";

export default class PerformanceDriver extends FilesPlus {
  render(cx) {
    const content = super.render(cx).on_size_change((size, cx) => {
      this.visible = size.width > 0 && size.height > 0;
      this.panelResized?.(size, cx);
    });
    return div().size_full().relative().child(content).when(this.fps, el => el.child(fps_monitor()));
  }
  init(p, cx) {
    super.init(p, cx);
    const base = props().base;
    cx.timer.every(250, cx => this.record(base, cx));
    cx.spawn(async cx => {
      for (;;) {
        await nextCommand();
        const request = JSON.parse(await readTextFile(`${base}/request.json`));
        if (request.type === "workspace") {
          setShared("multi-root.spaces", { [spaces().find(s => s.active).id]: request.workspace }); this.refresh(cx);
        } else if (request.type === "reset") globalThis.__fpStats = { exec: 0, rows: 0, programs: {}, since: Date.now() };
        else if (request.type === "fps") { this.fps = request.show !== false; cx.notify(); }
        this.record(base, cx);
        await writeTextFile(`${base}/receipt.json`, JSON.stringify({ ok: true, type: request.type }), await readTextFile(`${base}/receipt.json`));
      }
    });
  }
  record(base, cx) {
    if (this.recording) return;
    this.recording = true;
    const value = { stats: globalThis.__fpStats || {}, visible: this.visible, folders: this.folders?.size,
      entryCount: [...(this.entries?.values() || [])].reduce((n, rows) => n + rows.length, 0), error: this.error || null,
      loading: Boolean(this.loading), pending: this.pending?.size || 0, gitPending: Boolean(this.gitTimer), changePending: Boolean(this.changeTimer) || Boolean(this.changedPaths?.size), at: Date.now() };
    cx.spawn(async () => {
      const file = `${base}/performance-state.json`;
      try { await writeTextFile(file, JSON.stringify(value), await readTextFile(file)); }
      finally { this.recording = false; }
    });
  }
}
