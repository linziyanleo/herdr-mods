import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, focused, shared, openOverlay } from "herdr";
import { workspaceOf, describeRoots, rootOf, basename, putShared, REPO } from "./roots.js";

export function repositoryLocation() {
  const id = spaces().find(s => s.active)?.id;
  return workspaceOf(id) ? { space: id, cwd: shared(REPO)?.[id]?.root || null, on: null } : null;
}

export class WorkspaceChanges extends View {
  syncWorkspace(cx) {
    const id = spaces().find(s => s.active)?.id, entry = workspaceOf(id);
    this.workspace = entry; this.spaceId = id;
    const context = entry ? JSON.stringify([id, entry.folders.map(f => [f.path, f.name])]) : null;
    if (context !== this.workspaceContext) {
      this.workspaceContext = context; this.workspaceRoots = null; this.branch = "";
      this.lastFocusRoot = null;
      if (entry) cx.spawn(async cx => {
        const roots = await describeRoots(entry.folders);
        if (this.workspaceContext !== context) return;
        this.workspaceRoots = roots;
        const focus = rootOf(focused()?.cwd, roots), previous = shared(REPO)?.[id];
        this.lastFocusRoot = focus?.path || null;
        const top = focus?.top || (roots.some(f => f.top === previous?.root) ? previous.root : null) || roots.find(f => f.top)?.top;
        if (top) this.selectRepository(id, top, focus?.top ? "focus" : previous?.root === top ? previous.by : "focus");
        else {
          const repos = { ...(shared(REPO) || {}) };
          delete repos[id]; putShared(REPO, repos);
        }
        cx.notify();
      });
    }
    if (!entry || !this.workspaceRoots) return;
    const focus = rootOf(focused()?.cwd, this.workspaceRoots);
    if (focus && focus.path !== this.lastFocusRoot) {
      this.lastFocusRoot = focus.path;
      if (focus.top) this.selectRepository(id, focus.top, "focus");
    }
  }

  selectRepository(id, root, by) { putShared(REPO, { ...(shared(REPO) || {}), [id]: { root, by } }); }

  repositoryTitle(t) {
    const root = shared(REPO)?.[this.spaceId]?.root, folder = this.workspaceRoots?.find(f => f.top === root);
    return h_flex().id("repository-switcher").flex_1().min_w(0).gap(6).items_center().cursor_pointer()
      .on_mouse_down("left", (event, cx) => {
        cx.stop_propagation();
        openOverlay({ mod: "multi-root", kind: "popup", width: 320, height: 300, at: event.position, props: { role: "repo-menu", space: this.spaceId } });
      })
      .child(div().min_w(0).truncate().font_semibold().child(folder?.name || (root ? basename(root) : "Changes")))
      .child(div().text_color(t.dim).child("⌄"))
      .child(div().min_w(0).truncate().text_size(12).text_color(t.dim).child(this.branch || ""));
  }
}
