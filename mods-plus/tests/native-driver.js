// Test-only subclass of the real view, using the real helper with local source fixtures.
import ModsPlus from "./panel.js";
import { appHome, exec, props, readTextFile, writeTextFile, watchFolder, theme } from "herdr";

export default class NativeDriver extends ModsPlus {
  init(p, cx) {
    this.control = props()?.control;
    super.init(p, cx);
    if (!this.control) return;
    cx.spawn(async cx => {
      for (;;) {
        const text = await readTextFile(`${this.control}/request.json`);
        const request = text ? JSON.parse(text) : null;
        if (request && request.id !== this.handled) {
          this.handled = request.id;
          let error = null;
          try {
            if (request.action === "activate") globalThis.window.activate_window();
            else if (request.action === "discover") {
              this.importOpen = true;
              this.sourceInput.set_value(request.source || "fixture/packages");
              await this.discoverSource(cx);
            } else if (request.action === "details") {
              await this.showDetails(this.packages.find(pkg => pkg.id === request.package), cx);
            } else if (request.action === "review") await this.reviewPackage(this.selected, cx);
            else if (request.action === "install") await this.installPackage(this.selected, cx);
            else if (request.action === "enable") await this.enablePackage(this.selected, cx);
            else if (request.action === "check") await this.runUpdateCheck(cx);
            else if (request.action === "apply") await this.applyUpdate(this.selected, cx);
            else if (request.action === "remove") await this.removePackage(this.selected, cx);
            else if (request.action === "cancel") this.review = null;
            else if (request.action === "back") this.view = "catalog";
            else throw new Error("Unknown fixture action");
          } catch (e) { error = String(e); }
          cx.notify();
          const receipt = `${this.control}/receipt.json`;
          await writeTextFile(receipt, JSON.stringify({ id: request.id, error, message: this.message }), await readTextFile(receipt));
        }
        await watchFolder(this.control);
      }
    });
  }

  async helper(args) {
    const result = await exec("python3", ["-B", `${appHome()}/mods/mods-plus-driver/fixture-helper.py`,
      "--app-home", appHome(), "--json", ...args]);
    if (result.code) throw new Error((result.stderr || result.stdout).trim().split("\n").pop());
    return JSON.parse(result.stdout);
  }

  render(cx) {
    const element = super.render(cx);
    const text = JSON.stringify({ view: this.view, busy: this.busy, message: this.message,
      selected: this.selected, review: this.review, packages: this.packages, colors: theme() });
    if (this.control && text !== this.recorded && !this.recording) {
      this.recording = true;
      cx.spawn(async () => {
        try {
          const path = `${this.control}/state.json`;
          await writeTextFile(path, text, await readTextFile(path));
          this.recorded = text;
        } finally { this.recording = false; }
      });
    }
    return element;
  }
}
