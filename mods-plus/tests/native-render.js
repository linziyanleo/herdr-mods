// Eager native render of the production review controls; no network or helper actions.
import ModsPlus from "./panel.js";

export default class ReviewRender extends ModsPlus {
  init(_p, cx) {
    this.entry = false;
    this.view = "details";
    this.width = 1000;
    this.media = {};
    this.handle = cx.focus_handle();
    this.selected = { id: "fixture/packages/one", name: "Review fixture", author: "fixture", kind: "mod",
      description: "Native review controls", installed: false, stars: 0, source_url: "https://github.com/fixture/packages",
      install_prompt: "Read the fixture recipe", recipe: "# Fixture\nNative render acceptance." };
    this.review = { id: this.selected.id, operation: "install", token: "fixture", branch: "main", commit: "a".repeat(40), active: false,
      mod_changes: [{ path: "review-fixture", status: "add" }], layout_changes: [],
      changes: [{ path: "mods/review-fixture/main.js", status: "add" }], locally_modified: [], conflicts: [],
      shortcuts: [{ section: "global", key: "cmd-shift-x", action: "mod.open:review-fixture", current: "app.palette", status: "conflict" }] };
  }
}
