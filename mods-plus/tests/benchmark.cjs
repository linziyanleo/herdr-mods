// JS filtering and description work only. This is not native layout, latency or FPS.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const runtime = process.argv[2] || path.join(__dirname, '../mods/mods-plus');
const iterations = Number(process.argv[3] || 100);
let nodes = 0, cards = 0;
function element() {
  nodes++;
  let el;
  el = new Proxy({}, { get(_target, key) {
    if (key === 'when') return (condition, fn) => { if (condition) fn(el); return el; };
    if (key === 'child') return child => { child?.snapshot?.(); return el; };
    if (key === 'children') return children => { children.forEach(child => child?.snapshot?.()); return el; };
    return () => el;
  } });
  return el;
}
const source = fs.readFileSync(path.join(runtime, 'main.js'), 'utf8').replace(/^import .*;$/gm, '').replace('export default class ModsPlus', 'class ModsPlus');
const context = { View: class {}, div: element, h_flex: element, v_flex: element, svg: element, image: element,
  Input: { new: element }, Select: { new: element }, Popup: { new: element }, Scrollbar: { vertical: element },
  theme: () => ({}), settings: () => ({ zoom: 1 }), props: () => ({}),
};
const Mod = vm.runInNewContext(source + '\nModsPlus', context);
const cx = { notify() {}, new(Class, data) {
  const view = new Class(); view.init(data);
  return { dirty: true, set_props(data) { view.update(data); this.dirty = true; }, release() {}, snapshot() {
    if (this.dirty) { this.element = view.render(); this.dirty = false; } return this.element;
  } };
} };
const report = [];
for (const count of [96, 1302, 4096]) {
  const view = new Mod();
  Object.assign(view, { tab: 'mod', collection: 'community', filter: 'all', sort: 'popular', query: '', width: 1000, limit: 24,
    cards: new Map(), grid: [], catalogScroll: {}, media: {}, search: {}, sourceInput: {}, sortFocus: {}, sortListFocus: {}, packages: Array.from({ length: count }, (_, i) =>
      ({ id: `fixture/${i}`, kind: 'mod', collection: 'community', name: `Panel ${i}`, author: `author-${i%8}`, stars: (i*97)%1000, installed: false, preview_url: '' })) });
  const card = view.renderCard.bind(view);
  view.renderCard = (...args) => { cards++; return card(...args); };
  for (const scenario of ['same-state', 'filter-change', 'large-page']) {
    if (scenario === 'large-page') { view.query = ''; view.limit = Math.min(count, 240); }
    const samples = [];
    nodes = 0; cards = 0;
    for (let i = 0; i < iterations; i++) {
      if (scenario === 'filter-change') view.query = i % 2 ? 'Panel 1' : '';
      const start = performance.now();
      view.syncCards?.(cx);
      view.renderCatalog({});
      samples.push(performance.now() - start);
    }
    samples.sort((a,b) => a-b);
    report.push({ count, scenario, iterations: samples.length, median_ms: samples[Math.floor(iterations / 2)],
      p95_ms: samples[Math.min(iterations - 1, Math.floor(iterations * .95))], min_ms: samples[0], max_ms: samples.at(-1), nodes, cards });
  }
}
console.log(JSON.stringify({ runtime, scope: 'Node VM, JS filtering and builders; no native layout/GPU/network', report }, null, 2));
