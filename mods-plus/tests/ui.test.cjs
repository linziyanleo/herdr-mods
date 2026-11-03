// Exercise actual event handlers with expiring event contexts and deferred helpers.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function element() {
  const node = { nodes: [], attrs: {} };
  const proxy = new Proxy(node, { get(target, name) {
    if (name in target) return target[name];
    if (name === 'when') return (condition, fn) => condition ? fn(proxy) : proxy;
    if (name === 'child') return child => { node.nodes.push(child); return proxy; };
    if (name === 'children') return children => { node.nodes.push(...children); return proxy; };
    return (...args) => { node.attrs[name] = args; return proxy; };
  } });
  return proxy;
}

function setup() {
  const values = new Map();
  const source = fs.readFileSync(path.join(__dirname, '../mods/mods-plus/main.js'), 'utf8')
    .replace(/^import .*;$/gm, '').replace('export default class ModsPlus', 'class ModsPlus');
  const runtime = { View: class {}, div: element, h_flex: element, v_flex: element, svg: element,
    shared: key => values.get(key), setShared: (key, value) => values.set(key, value),
    props: () => ({ entry: true, footer: true }), layout: () => ({ id: 'sidebar', size: { px: 240 } }),
    updates: () => ({ app: {} }), run() {} };
  const Mod = vm.runInNewContext(source + '\nModsPlus', runtime);
  const view = new Mod();
  Object.assign(view, { settings: { auto_update: false, interval_hours: 24 }, workDepth: 0,
    entry: false, checking: false, savingSettings: false, preparedCount: 0, packages: [],
    media: {}, loadingMedia: false, query: '', limit: 24, tab: 'mod', collection: 'community', filter: 'all' });
  const tasks = [];
  function context(persistent = false) {
    return { valid: true, notify() { assert.ok(this.valid || persistent, 'expired cx'); },
      stop_propagation() { assert.ok(this.valid || persistent); },
      spawn(fn) { assert.ok(this.valid || persistent); const task = Promise.resolve().then(() => fn(context(true))); tasks.push(task); return task; } };
  }
  function click(node) {
    const cx = context();
    node.attrs.on_click[0]({}, cx);
    cx.valid = false;
  }
  async function drain() { while (tasks.length) await Promise.all(tasks.splice(0)); }
  return { view, values, click, drain, context };
}

function find(nodes, id) {
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    if (node.attrs?.id?.[0] === id) return node;
    const found = find(node.nodes || [], id);
    if (found) return found;
  }
}

function textOf(node) {
  return typeof node === 'string' ? node : (node?.nodes || []).map(textOf).join(' ');
}

test('settings toggles and intervals survive await, refresh and reject repeated clicks', async () => {
  const { view, click, drain } = setup();
  let calls = 0;
  view.helper = async args => { calls++; await Promise.resolve(); return {
    ...view.settings, auto_update: args[1] === '--auto-update' ? args[2] === 'true' : view.settings.auto_update,
    interval_hours: args[1] === '--interval' ? Number(args[2]) : view.settings.interval_hours,
  }; };
  const toggle = find(view.renderSettings({}), 'btn-toggle-auto');
  click(toggle); click(toggle);
  await drain();
  assert.equal(calls, 1);
  assert.equal(view.settings.auto_update, true);
  assert.match(textOf(find(view.renderSettings({}), 'btn-toggle-auto')), /Enabled/);
  click(find(view.renderSettings({}), 'btn-interval-6'));
  await drain();
  assert.equal(view.settings.interval_hours, 6);
  assert.equal(view.message, null);
  assert.equal(view.busy, null);
});

test('manual check updates footer immediately, retains busy state through refresh and reports partial failure', async () => {
  const { view, values, click, drain } = setup();
  let checks = 0;
  view.helper = async args => {
    await Promise.resolve();
    if (args[0] === 'check-updates') { checks++; return { count: 2, errors: [{ id: 'offline/mod', error: 'offline' }] }; }
    if (args[0] === 'settings') return { prepared_updates_count: 2 };
    assert.ok(view.busy);
    return { packages: [] };
  };
  const button = find(view.renderSettings({}), 'btn-check-now');
  click(button); click(button);
  await drain();
  assert.equal(checks, 1);
  assert.match(view.message, /Could not check 1 package/);
  assert.doesNotMatch(view.message, /up to date/);
  assert.equal(view.checking, false);
  assert.equal(view.busy, null);
  assert.equal(values.get('mods-plus.updates').count, 2);
  assert.match(textOf(find([view.renderEntry({})], 'plugins')), /Plugins\s+2/);
});

test('failed save resets controls and presents an error without changing the selection', async () => {
  const { view, click, drain } = setup();
  view.helper = async () => { throw new Error('disk unavailable'); };
  click(find(view.renderSettings({}), 'btn-interval-1'));
  await drain();
  assert.equal(view.settings.interval_hours, 24);
  assert.equal(view.savingSettings, false);
  assert.equal(view.busy, null);
  assert.match(view.message, /disk unavailable/);
});

test('automatic checks publish the numeric badge without opening a dialog', async () => {
  const { view, values, context } = setup();
  view.entry = true;
  let checked = false;
  view.helper = async args => {
    if (args[0] === 'settings') return { overdue: !checked, prepared_updates_count: checked ? 3 : 0 };
    assert.equal(args.join(' '), 'check-updates --if-overdue');
    checked = true;
    return { count: 3, errors: [] };
  };
  await view.checkOverdue(context(true));
  assert.equal(values.get('mods-plus.updates').count, 3);
  assert.match(textOf(find([view.renderEntry({})], 'plugins')), /Plugins\s+3/);
  assert.equal(view.checking, false);
  view.acceptSettings({ prepared_updates_count: 0 });
  assert.doesNotMatch(textOf(find([view.renderEntry({})], 'plugins')), /3/);
});
