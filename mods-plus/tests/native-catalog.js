// Native JS description/card work, with deterministic data and no transport or mutations.
import ModsPlus from "./panel.js";
import { props, readTextFile, writeTextFile, theme, setWindowTitle, checking } from "herdr";

export default class NativeCatalog extends ModsPlus {
  init(p, cx) {
    const options = props() || {};
    this.fixture = [];
    this.ready = new Promise(resolve => { this.fixtureReady = resolve; });
    cx.spawn(async cx => {
      for (let index = 0; index < (options.count || 96); index++) {
        this.fixture.push({
          id: `fixture/package-${index}`, name: `Panel ${String(index).padStart(4, "0")}`, author: `Author ${index % 8}`,
          kind: "mod", collection: "community", installed: index % 11 === 0, enabled: false,
          has_update: index % 23 === 0, stars: index % 97, pushed: "2026-11-16", preview_url: "", avatar_url: "",
          description: "Disposable native catalog fixture", recipe: "# Fixture\nNative catalog inspection.",
          install_prompt: "Disposable fixture. No installation action is implemented.", source_url: "https://github.com/fixture/packages",
        });
        if (index % 64 === 63) await cx.sleep(0);
      }
      this.fixtureReady();
    });
    this.measured = { renders: 0, cards: 0, outer_ms: [], card_ms: 0 };
    super.init(p, cx);
    this.limit = options.limit || 24;
    setWindowTitle("Mods Plus isolated acceptance");
    if (!checking()) globalThis.window.activate_window();
    cx.timer.every(500, cx => this.record(cx));
  }

  async helper(args) {
    await this.ready;
    if (args[0] === "catalog") return { packages: this.fixture, stale: false, warnings: [] };
    if (args[0] === "media") return { media: JSON.parse(args[1]).map(id => ({ id })) };
    if (args[0] === "details") return { ...this.fixture.find(pkg => pkg.id === args[1]) };
    if (args[0] === "settings") return { auto_update: false, interval_value: 24, interval_unit: "hr", prepared_updates_count: 0 };
    throw new Error("Package mutations are unavailable in the catalog measurement fixture");
  }

  renderCard(...args) {
    const started = Date.now(), element = super.renderCard(...args);
    this.measured.cards++; this.measured.card_ms += Date.now() - started;
    return element;
  }

  render(cx) {
    const started = Date.now(), element = super.render(cx);
    this.measured.renders++; this.measured.outer_ms.push(Date.now() - started);
    if (this.measured.outer_ms.length > 100) this.measured.outer_ms.shift();
    return element;
  }

  record(cx) {
    if (this.writing) return;
    const text = JSON.stringify({ label: props().label, count: this.fixture.length, view: this.view, width: this.width, query: this.query,
      limit: this.limit, sort: this.sort, selected: this.selected?.id, motion: this.motion, busy: this.busy,
      measured: this.measured, cardExtra: this.cardExtra, colors: theme() });
    if (text === this.recorded) return;
    this.writing = true;
    cx.spawn(async () => {
      try { const file = props().record; await writeTextFile(file, text, await readTextFile(file)); this.recorded = text; }
      finally { this.writing = false; }
    });
  }
}
