// Materialize the search UI during `herdr-app check`, without a core or window.
import { View } from "gpui-kit";
import { v_flex } from "gpui-base";
import { FileSearch } from "./search.js";
import { appearance } from "./appearance.js";

export default class SearchCheck extends View {
  init(_props, cx) {
    this.search = new FileSearch({ current: () => true, openFile() {} }, async () => [], cx);
    this.search.query = "same";
    this.search.input.set_value("same");
    this.search.roots = [{ path: "/fixture/web" }, { path: "/fixture/api" }];
    this.search.results = this.search.roots.map(root => ({ key: root.path, root: root.path, path: root.path + "/src/Same.txt", relative: "src/Same.txt", on: null }));
    this.search.failures = 1; this.search.errors = ["/fixture/missing: Cannot list this folder"];
  }
  render() {
    const { colors, font } = appearance();
    return v_flex().w(320).h(400).font_family(font).text_color(colors.foreground).bg(colors.background)
      .child(this.search.renderInput(colors)).child(this.search.renderResults(colors));
  }
  close() { this.search.close(); }
}
