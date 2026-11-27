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
  const runtime = { View: class {}, div: element, h_flex: element, v_flex: element, svg: element, image: element,
    TextView: { markdown: (_id, value) => element().child(value) }, Select: { new: element }, Popup: { new: element }, notify() {},
    ScrollHandle: { new: () => ({ scroll_to_item() {}, release() {} }) },
    hostChecking: () => false,
    Switch: { new: id => element().id(id) }, Input: { new: () => element() },
    InputState: { new: ({ value }) => ({ text: value, events: {}, value() { return this.text; },
      set_value(value) { this.text = value; }, on(event, fn) { this.events[event] = fn; }, release() {} }) },
    shared: key => values.get(key), setShared: (key, value) => values.set(key, value),
    props: () => ({ entry: true, footer: true }), layout: () => ({ id: 'sidebar', size: { px: 240 } }),
    updates: () => ({ app: {} }), settings: () => ({ zoom: 1 }), theme: () => ({}), run() {}, appHome: () => '/fixture' };
  const Mod = vm.runInNewContext(source + '\nModsPlus', runtime);
  const view = new Mod();
  Object.assign(view, { settings: { auto_update: false, interval_value: 24, interval_unit: 'hr' }, workDepth: 0,
    entry: false, checking: false, savingSettings: false, preparedCount: 0, packages: [],
    cards: new Map(), grid: [], catalogScroll: { scroll_to_item() {}, release() {} }, media: {}, loadingMedia: false, query: '', limit: 24, tab: 'mod', collection: 'community', filter: 'all', width: 1000 });
  view.initIntervalInput();
  view.initSourceInput();
  const tasks = [];
  function context(persistent = false) {
    return { valid: true, notify() { assert.ok(this.valid || persistent, 'expired cx'); },
      new(Class, data) {
        const view = new Class(); view.init(data);
        const entity = { dirty: true, set_props(data) { view.update(data); this.dirty = true; }, release() {},
          snapshot() { if (this.dirty) { this.element = view.render(); this.dirty = false; } return this.element; } };
        return entity;
      },
      stop_propagation() { assert.ok(this.valid || persistent); },
      async sleep() { assert.ok(this.valid || persistent); },
      spawn(fn) { assert.ok(this.valid || persistent); const task = Promise.resolve().then(() => fn(context(true))); tasks.push(task); return task; },
      timer: { after(ms, fn) { let cancelled = false;
        tasks.push(Promise.resolve().then(() => { if (!cancelled) return fn(context(true)); }));
        return { cancel() { cancelled = true; } }; } } };
  }
  function click(node) {
    const cx = context();
    if (node.attrs.disabled?.[0]) return;
    if (node.attrs.on_change) node.attrs.on_change[0](!node.attrs.checked[0], cx);
    else node.attrs.on_click[0]({}, cx);
    cx.valid = false;
  }
  async function drain() { while (tasks.length) await Promise.all(tasks.splice(0)); }
  return { view, values, click, drain, context, runtime };
}

function find(nodes, id) {
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    if (Object.hasOwn(node, 'snapshot')) { const found = find([node.snapshot()], id); if (found) return found; continue; }
    if (node.attrs?.id?.[0] === id) return node;
    const found = find(node.nodes || [], id);
    if (found) return found;
  }
}

function textOf(node) {
  return typeof node === 'string' ? node : (node?.nodes || []).map(textOf).join(' ');
}

test('import and reviewed mutations retain their tokens through the job helper', async () => {
  const { view, runtime, context } = setup(), calls = [];
  const pkg = { id: 'owner/repo/one', repo: 'owner/repo', subdir: 'one', name: 'One', kind: 'mod' };
  let result;
  runtime.exec = async (_command, args) => {
    if (args[4] === 'start') {
      const request = JSON.parse(args[5]);
      calls.push(request);
      result = request[0] === 'discover' ? { packages: [pkg], branch: 'main' }
        : request[0] === 'review' ? { id: pkg.id, operation: request.includes('--update') ? 'update' : 'install', token: 'review-token' }
        : { ok: true };
      return { code: 0, stdout: JSON.stringify({ id: 'job', state: 'running' }) };
    }
    assert.equal(args[4], 'status');
    return { code: 0, stdout: JSON.stringify({ id: 'job', state: 'done', result }) };
  };
  view.showDetails = view.loadCatalog = view.loadSettings = async () => {};
  view.sourceInput.set_value('owner/repo');
  const cx = context(true);
  await view.discoverSource(cx);
  assert.equal(view.packages[0].id, pkg.id);
  view.selected = pkg;
  await view.reviewPackage(pkg, cx);
  await view.installPackage(pkg, cx);
  const installed = { ...pkg, installed: true };
  view.selected = installed;
  await view.reviewPackage(installed, cx);
  await view.applyUpdate(installed, cx);
  assert.deepEqual(calls, [
    ['discover', 'owner/repo'], ['review', pkg.id],
    ['install', pkg.repo, pkg.subdir, '--review', 'review-token'],
    ['review', pkg.id, '--update'], ['apply-update', pkg.id, '--review', 'review-token'],
  ]);
  assert.equal(view.message, null);
  assert.equal(view.busy, null);
});

test('helper polls short RPCs and labels terminal errors with the operation', async () => {
  const { view, runtime, context } = setup();
  const calls = [];
  const replies = [{ id: 'job', state: 'running' }, { id: 'job', state: 'running' },
    { id: 'job', state: 'done', result: { count: 1 } }];
  runtime.exec = async (command, args) => {
    calls.push(args);
    assert.equal(command, 'python3');
    return { code: 0, stdout: JSON.stringify(replies.shift()) };
  };
  assert.equal((await view.helper(['check-updates'], context(true))).count, 1);
  assert.deepEqual(calls.map(args => args[4]), ['start', 'status', 'status']);
  replies.push({ id: 'job', state: 'failed', error: 'Validation timed out' });
  await assert.rejects(view.helper(['install', 'owner/pkg'], context(true)), /install: Validation timed out/);
});

test('media progress uses the batch job channel and ignores repeated snapshots', async () => {
  const { view, runtime, context } = setup(), calls = [], progress = [];
  const partial = { media: [{ id: 'one', preview_path: 'fast.png' }] };
  const replies = [{ id: 'job', state: 'running' }, { id: 'job', state: 'running', progress: partial },
    { id: 'job', state: 'running', progress: partial }, { id: 'job', state: 'done', result: partial }];
  runtime.exec = async (_command, args) => { calls.push(args); return { code: 0, stdout: JSON.stringify(replies.shift()) }; };
  await view.helper(['media', '["one"]'], context(true), value => progress.push(value), 'source-identity');
  assert.equal(progress.length, 1); assert.equal(progress[0].media[0].preview_path, 'fast.png');
  assert.deepEqual(JSON.parse(calls[0][5]), ['media', '["one"]', 'source-identity']);
  assert.deepEqual(calls.map(args => args[4]), ['start', 'status', 'status', 'status']);
});

test('cached catalog is visible before refresh finishes', async () => {
  const { view, context } = setup();
  let finish;
  let started;
  const refreshing = new Promise(resolve => { started = resolve; });
  view.loadMedia = () => {};
  view.helper = async args => args.includes('--cached')
    ? { packages: [{ id: 'cached' }], stale: true }
    : new Promise(resolve => { finish = resolve; started(); });
  const task = view.loadCatalog(context(true));
  await refreshing;
  assert.equal(view.packages[0].id, 'cached');
  finish({ packages: [{ id: 'fresh' }] });
  await task;
  assert.equal(view.packages[0].id, 'fresh');
});

test('Refresh catalog fetches new entries even with a fresh cache', async () => {
  const { view, click, drain, context } = setup();
  const cached = { ...importedPackage, collection: 'community', name: 'Panel' };
  const added = { ...cached, id: 'owner/repo/two', name: 'Panel Two', pushed: '2026-11-27T08:00:00Z' };
  const calls = [];
  Object.assign(view, { view: 'catalog', packages: [cached], filter: 'not_installed', sort: 'new', query: 'panel' });
  view.loadMedia = () => {};
  view.helper = async args => {
    calls.push(Array.from(args));
    return { packages: args.includes('--refresh') ? [cached, added] : [cached], stale: false };
  };
  const button = find([view.render(context(true))], 'refresh-catalog');
  assert.ok(button, 'The catalog needs a refresh action');
  click(button);
  await drain();
  assert.deepEqual(calls, [['catalog', '--cached'], ['catalog', '--refresh']]);
  assert.deepEqual(Array.from(view.visiblePackages(), pkg => pkg.name), ['Panel Two', 'Panel']);
  assert.equal(view.query, 'panel');
  assert.equal(view.filter, 'not_installed');
});

test('Newest puts later entries first regardless of previews or installed state', () => {
  const { view } = setup();
  const base = { ...importedPackage, collection: 'community', stars: 100, pushed: '2026-11-25T00:00:00Z' };
  view.packages = [
    { ...base, name: 'Older with preview', preview_url: 'image.png' },
    { ...base, name: 'Older installed', installed: true },
    { ...base, name: 'Recent', stars: 0, pushed: '2026-11-27T00:00:00Z' },
  ];
  view.sort = 'new';
  assert.deepEqual(Array.from(view.visiblePackages(), pkg => pkg.name),
    ['Recent', 'Older installed', 'Older with preview']);
  view.sort = 'popular';
  assert.deepEqual(Array.from(view.visiblePackages(), pkg => pkg.name),
    ['Older installed', 'Older with preview', 'Recent']);
});

test('failed refresh retains cached data and superseded or closed requests cannot replace it', async () => {
  const { view, context } = setup(); view.loadMedia = () => {};
  view.helper = async args => args.includes('--cached') ? { packages: [importedPackage], stale: true } : Promise.reject(new Error('offline'));
  await view.loadCatalog(context(true));
  assert.equal(view.packages[0].id, importedPackage.id); assert.equal(view.catalogState, 'stale'); assert.match(view.catalogWarning, /offline/);
  const pending = [];
  view.helper = () => new Promise(resolve => pending.push(resolve));
  const old = view.loadCatalog(context(true)), recent = view.loadCatalog(context(true));
  pending[1]({ packages: [{ ...importedPackage, name: 'New' }], stale: false }); await recent;
  pending[0]({ packages: [{ ...importedPackage, name: 'Old' }], stale: false }); await old;
  assert.equal(view.packages[0].name, 'New');
  const closing = view.loadCatalog(context(true)); view.close();
  pending[2]({ packages: [{ ...importedPackage, name: 'Closed' }], stale: false }); await closing;
  assert.equal(view.packages[0].name, 'New');
  const settings = setup(), before = settings.view.settings;
  let finish; settings.view.helper = () => new Promise(resolve => { finish = resolve; });
  const loading = settings.view.loadSettings(settings.context(true)); settings.view.close();
  finish({ auto_update: true }); await loading; assert.equal(settings.view.settings, before);
});

test('cold catalog failure reports unavailable and refresh warnings survive other actions', async () => {
  const { view, context } = setup();
  view.view = 'catalog';
  view.loadMedia = () => {};
  view.helper = async args => ({ packages: [], stale: true,
    warnings: [args.includes('--cached') ? 'Pending refresh' : 'Mods index: no download progress'] });
  const cx = context(true);
  await view.loadCatalog(cx);
  await view.work(cx, 'Checking…', async () => { view.message = 'No updates'; });
  const text = textOf(view.render(cx));
  assert.match(text, /Official catalog unavailable/);
  assert.match(text, /Mods index: no download progress/);
  assert.match(text, /No updates/);
  assert.doesNotMatch(text, /Cached catalog|Pending refresh/);
});

test('an old image batch cannot overwrite a refreshed URL and filtering stays bounded', async () => {
  const { view, context, drain } = setup(); view.collection = 'direct';
  view.packages = Array.from({ length: 50 }, (_, i) => ({ ...importedPackage, id: String(i), name: `Panel ${i}` }));
  let release; const batches = [];
  view.helper = args => {
    const ids = JSON.parse(args[1]); batches.push(ids);
    if (batches.length === 1) return new Promise(resolve => { release = resolve; });
    return Promise.resolve({ media: ids.map(id => ({ id, preview_path: 'fresh.png' })) });
  };
  view.loadMedia(context(true)); await Promise.resolve();
  view.acceptCatalog({ packages: view.packages.map(pkg => ({ ...pkg, preview_url: 'new-url' })) });
  view.query = 'Panel 49'; release({ media: [{ id: '0', preview_path: 'old.png' }] }); await drain();
  assert.equal(view.media['0'], undefined); assert.equal(view.media['49'].preview_path, 'fresh.png');
  assert.deepEqual(batches.map(ids => ids.length), [4, 1]); assert.equal(view.loadingMedia, false);
});

test('retained cards update badges and bubble clicks through their parent event context', async () => {
  const { view, context, click, drain } = setup(); view.view = 'catalog'; view.collection = 'direct';
  view.packages = [importedPackage]; view.syncCards(context());
  const entity = view.cards.get(importedPackage.id).view;
  view.syncCards(context()); assert.equal(view.cards.get(importedPackage.id).view, entity);
  view.acceptCatalog({ packages: [{ ...importedPackage, has_update: true }] }); view.syncCards(context());
  assert.match(textOf(entity.snapshot()), /Update Available/);
  let opened; view.showDetails = async pkg => { opened = pkg; };
  click(entity.snapshot()); click(find(view.renderCatalog({}), 'catalog-scroll')); await drain();
  assert.equal(opened, view.packages[0]); assert.equal(opened.has_update, true);
  view.motion = false; assert.equal(view.tabPill({}, 'filter', 'Filter', false, () => {}).attrs.transition, undefined);
  view.motion = true; assert.equal(view.tabPill({}, 'filter', 'Filter', false, () => {}).attrs.transition[0], 'opacity');
});

test('details A-B-A and dismissed requests cannot publish late content or errors', async () => {
  const { view, context } = setup(); view.view = 'details';
  const pending = [];
  view.helper = () => new Promise((resolve, reject) => pending.push({ resolve, reject }));
  const first = view.showDetails(importedPackage, context(true));
  const second = view.showDetails({ ...importedPackage, id: 'second' }, context(true));
  const third = view.showDetails(importedPackage, context(true));
  pending[2].resolve({ ...importedPackage, recipe: 'Current' }); await third;
  pending[0].resolve({ ...importedPackage, recipe: 'Old' }); await first;
  pending[1].reject(new Error('Old error')); await second;
  assert.equal(view.selected.recipe, 'Current'); assert.equal(view.message, null);
  const dismissed = view.showDetails(importedPackage, context(true)); view.view = 'catalog'; view.detailsRequest = null;
  pending[3].reject(new Error('Dismissed error')); await dismissed; assert.equal(view.message, null);
});

test('media loads in small batches and a failed batch does not stop later cards', async () => {
  const { view, context, drain } = setup();
  view.packages = Array.from({ length: 9 }, (_, i) => ({ id: String(i), kind: 'mod', collection: 'community',
    name: String(i), author: '', description: '', stars: 0 }));
  const batches = [];
  view.helper = async args => {
    const ids = JSON.parse(args[1]); batches.push(ids);
    if (batches.length === 1) throw new Error('image job stopped');
    return { media: ids.map(id => ({ id, preview_path: id + '.png' })) };
  };
  view.loadMedia(context(true));
  await drain();
  assert.deepEqual(batches.map(ids => ids.length), [4, 4, 1]);
  assert.equal(Object.keys(view.media).length, 9);
  assert.equal(view.media['8'].preview_path, '8.png');
  assert.equal(view.loadingMedia, false);
  assert.equal(view.message, undefined);
});

test('partial media is visible before the batch finishes and stale progress is ignored', async () => {
  const { view, context, drain } = setup(); view.view = 'catalog'; view.collection = 'direct';
  view.packages = [importedPackage, { ...importedPackage, id: 'slow' }];
  let progress, finish;
  view.helper = (_args, _cx, onProgress) => new Promise(resolve => { progress = onProgress; finish = resolve; });
  view.loadMedia(context(true)); await Promise.resolve();
  progress({ media: [{ id: importedPackage.id, preview_path: 'fast.png' }, { id: 'slow', preview_pending: true }] });
  assert.equal(view.loadingMedia, true); assert.equal(view.media[importedPackage.id].preview_path, 'fast.png');
  assert.match(textOf(view.preview({}, { ...importedPackage, id: 'slow', preview_url: 'slow-url' }, 100, 60)), /Loading preview/);
  view.view = 'details'; view.acceptCatalog({ packages: [{ ...importedPackage, preview_url: 'new-url' }] });
  progress({ media: [{ id: importedPackage.id, preview_path: 'obsolete.png' }] });
  assert.equal(view.media[importedPackage.id], undefined);
  finish({ media: [{ id: importedPackage.id, preview_path: 'obsolete.png' }] }); await drain();
  assert.equal(view.media[importedPackage.id], undefined); assert.equal(view.loadingMedia, false);
  view.close(); progress({ media: [{ id: importedPackage.id, preview_path: 'closed.png' }] });
  assert.equal(view.media[importedPackage.id], undefined);
});

test('settings toggles and intervals survive await, refresh and reject repeated clicks', async () => {
  const { view, click, drain } = setup();
  let calls = 0;
  view.helper = async args => { calls++; await Promise.resolve(); return {
    ...view.settings, auto_update: args[1] === '--auto-update' ? args[2] === 'true' : view.settings.auto_update,
    interval_value: args[1] === '--interval-value' ? Number(args[2]) : view.settings.interval_value,
    interval_unit: args[1] === '--interval-value' ? args[4] : view.settings.interval_unit,
  }; };
  const toggle = find(view.renderSettings({}), 'btn-toggle-auto');
  click(toggle); click(toggle);
  await drain();
  assert.equal(calls, 1);
  assert.equal(view.settings.auto_update, true);
  assert.equal(find(view.renderSettings({}), 'btn-toggle-auto').attrs.checked[0], true);
  view.intervalInput.set_value('6');
  click(find(view.renderSettings({}), 'interval-min'));
  await drain();
  assert.equal(view.settings.interval_value, 6);
  assert.equal(view.settings.interval_unit, 'min');
  assert.equal(view.message, null);
  assert.equal(view.busy, null);
});

const importedPackage = { id: 'owner/repo/one', repo: 'owner/repo', subdir: 'one', kind: 'mod',
  collection: 'direct', branch: 'main', name: 'One', author: 'owner', description: '', stars: 0, pushed: '',
  source_url: 'https://github.com/owner/repo/tree/main/one', install_prompt: 'Install One', installed: false };
function proposal(operation = 'install') {
  return { id: importedPackage.id, operation, token: 'review-token', branch: 'main', commit: 'abcdef123', active: false,
    changes: [{ path: 'mods/one/main.js', status: 'add' }], mod_changes: [{ path: 'one', status: 'add' }],
    layout_changes: [], conflicts: [], locally_modified: [],
    shortcuts: [{ section: 'global', key: 'cmd-shift-x', action: 'mod.open:one', current: 'app.palette', status: 'conflict' }] };
}

test('GitHub input submits discovery, shows both kinds and keeps errors actionable', async () => {
  const { view, drain, context } = setup();
  const calls = [];
  view.sourceInput.set_value('owner/repo');
  view.helper = async args => { calls.push(Array.from(args)); return { branch: 'main', packages: [importedPackage,
    { ...importedPackage, id: 'owner/repo/two', kind: 'layout' }] }; };
  const cx = context();
  view.sourceInput.events.submit({}, cx); cx.valid = false;
  await drain();
  assert.deepEqual(calls, [['discover', 'owner/repo']]);
  assert.equal(view.collection, 'direct');
  assert.equal(view.visiblePackages().length, 1);
  view.tab = 'layout';
  assert.equal(view.visiblePackages()[0].id, 'owner/repo/two');
  view.helper = async () => { throw new Error('Use an HTTPS github.com URL'); };
  await view.discoverSource(context(true));
  assert.match(view.message, /github.com/);
  assert.equal(view.packages.length, 2);
});

test('details require review, cancellation writes nothing, confirmation binds the reviewed token', async () => {
  const { view, click, drain } = setup();
  view.selected = importedPackage;
  view.view = 'details';
  const calls = [];
  view.helper = async args => { calls.push(Array.from(args)); return proposal(); };
  assert.equal(find(view.renderDetails({}), 'confirm-review'), undefined);
  click(find(view.renderDetails({}), 'review-install'));
  await drain();
  const rendered = view.renderDetails({});
  assert.match(textOf(find(rendered, 'package-review')), /mods\/one\/main.js/);
  assert.match(textOf(find(rendered, 'package-review')), /Keep existing: app.palette/);
  click(find(rendered, 'cancel-review'));
  assert.equal(view.review, null);
  assert.deepEqual(calls, [['review', importedPackage.id]]);
  click(find(view.renderDetails({}), 'review-install'));
  await drain();
  view.showDetails = async () => {};
  view.loadCatalog = async () => {};
  view.helper = async args => { calls.push(Array.from(args)); return { ok: true }; };
  const confirm = find(view.renderDetails({}), 'confirm-review');
  click(confirm); click(confirm);
  await drain();
  assert.deepEqual(calls.at(-1), ['install', 'owner/repo', 'one', '--review', 'review-token']);
  assert.equal(calls.filter(args => args[0] === 'install').length, 1);
  assert.equal(calls.filter(args => args[0] === 'enable').length, 0);
});

test('updates require review and stale-review failures preserve the selected package', async () => {
  const { view, click, drain } = setup();
  view.selected = { ...importedPackage, installed: true, has_update: true, enabled: true };
  view.view = 'details';
  const calls = [];
  view.helper = async args => {
    calls.push(Array.from(args));
    return args[0] === 'review' ? proposal('update') : { ok: false, error: 'Candidate changed since review' };
  };
  click(find(view.renderDetails({}), 'review-update'));
  await drain();
  click(find(view.renderDetails({}), 'confirm-review'));
  await drain();
  assert.deepEqual(calls, [['review', importedPackage.id, '--update'], ['apply-update', importedPackage.id, '--review', 'review-token']]);
  assert.match(view.message, /changed since review/);
  assert.equal(view.selected.has_update, true);
  assert.equal(view.busy, null);
});

test('manual check updates cards and footer without catalog reload and reports partial failure', async () => {
  const { view, values, click, drain } = setup();
  let checks = 0;
  view.query = 'my query';
  view.packages = [{ id: 'one', has_update: false }, { id: 'old', has_update: true }];
  view.helper = async args => {
    await Promise.resolve();
    assert.equal(args[0], 'check-updates', 'check should not reload catalog or settings');
    checks++;
    return { count: 2, settings: { ...view.settings, prepared_updates_count: 2, prepared_update_ids: ['one', 'two'] },
      errors: [{ id: 'offline/mod', error: 'offline' }] };
  };
  const button = find(view.renderSettings({}), 'btn-check-now');
  click(button); click(button);
  await drain();
  assert.equal(checks, 1);
  assert.match(view.message, /Could not check 1 package/);
  assert.doesNotMatch(view.message, /up to date/);
  assert.equal(view.checking, false);
  assert.equal(view.busy, null);
  assert.equal(view.query, 'my query');
  assert.equal(view.packages[0].has_update, true);
  assert.equal(view.packages[1].has_update, false);
  assert.equal(values.get('mods-plus.updates').count, 2);
  assert.match(textOf(find([view.renderEntry({})], 'plugins')), /Plugins\s+2/);
});

test('installed entry and details preserve catalog state and reuse update review', async () => {
  const { view, values, click, context, drain } = setup();
  const cx = context(true), calls = [];
  const active = { id: 'owner/repo/one', name: 'One', kind: 'mod', activation: 'active', recorded: true,
    provenance: 'recorded', source: { repo: 'owner/repo', branch: 'main', commit: 'a'.repeat(40) },
    candidate: { commit: 'b'.repeat(40), conflicts: ['mods/one/main.js'] },
    drift: [{ path: 'mods/one/main.js', status: 'change' }], check: { state: 'failed', error: 'offline', at: 1000 } };
  const stored = { id: 'owner/repo/two', name: 'Two', kind: 'layout', activation: 'stored', recorded: true,
    provenance: 'recorded', check: { state: 'unchanged', at: 1000 } };
  const loose = { id: 'local:mod:clone', name: 'clone', kind: 'mod', activation: 'active', provenance: 'ambiguous',
    matches: [{ repo: 'owner/repo', branch: 'main', commit: 'a'.repeat(40) }, { repo: 'other/repo', branch: 'dev' }] };
  view.view = 'catalog';
  view.query = 'existing query'; view.tab = 'layout'; view.filter = 'installed'; view.limit = 48;
  view.packages = [{ ...importedPackage, name: 'Existing query', kind: 'layout', collection: 'community', installed: true }];
  view.acceptSettings({ ...view.settings, prepared_updates_count: 1, prepared_update_ids: [active.id] });
  view.catalogScroll.scroll_to_item = () => assert.fail('Catalog scroll was reset');
  view.loadMedia = () => {};
  view.helper = async args => {
    calls.push(Array.from(args));
    if (args[0] === 'installed') return { cache: 'incomplete', count: 2, packages: [active, stored, loose] };
    if (args[0] === 'details') return { ...importedPackage, inventory: active, recipe: 'Stored recipe' };
    return proposal('update');
  };
  click(find([view.render(cx)], 'installed-packages'));
  await drain();
  const rows = view.renderInstalled({});
  assert.match(rows.map(textOf).join(' '), /Source cache unavailable or incomplete/);
  assert.match(textOf(find(rows, `installed-${stored.id}`)), /No update at last check.*Layout · Stored only/);
  assert.match(textOf(find(rows, `installed-${active.id}`)), /Update Available · Local changes · Conflicts at preparation · Last check failed.*Mod · Active/);
  click(find(rows, `installed-${loose.id}`));
  assert.deepEqual(calls, [['installed']]);
  await drain();
  const looseDetails = view.renderDetails({});
  assert.match(looseDetails.map(textOf).join(' '), /Source ambiguous.*Cached byte match · owner\/repo.*Cached byte match · other\/repo/);
  for (const id of ['review-install', 'review-update', 'remove']) assert.equal(find(looseDetails, id), undefined);
  click(find(looseDetails, 'back')); await drain();
  click(find(view.renderInstalled({}), `installed-${active.id}`)); await drain();
  click(find(view.renderDetails({}), 'review-update')); await drain();
  assert.deepEqual(calls.slice(-2), [['details', active.id, '--installed'], ['review', active.id, '--update']]);
  click(find(view.renderDetails({}), 'back')); await drain();
  click(find(view.renderInstalled({}), 'back-installed'));
  assert.equal(view.view, 'catalog');
  assert.deepEqual([view.query, view.tab, view.filter, view.limit], ['existing query', 'layout', 'installed', 48]);
  assert.equal(values.get('mods-plus.updates').count, 1);
});

test('installed load failures and dismissed replies cannot look current', async () => {
  const { view, context } = setup(), cx = context(true);
  view.loadMedia = () => {};
  view.helper = async () => { throw new Error('Read failed'); };
  await view.showInstalled(cx);
  assert.match(view.renderInstalled({}).map(textOf).join(' '), /Could not load installed packages · Read failed/);
  let resolve;
  view.helper = () => new Promise(done => { resolve = done; });
  const pending = view.showInstalled(cx);
  view.back(cx);
  resolve({ cache: 'cached', count: 0, packages: [] });
  await pending;
  assert.equal(view.view, 'catalog');
  assert.equal(view.installed, null);
});

test('failed save resets controls and presents an error without changing the selection', async () => {
  const { view, click, drain } = setup();
  view.helper = async () => { throw new Error('disk unavailable'); };
  view.intervalInput.set_value('1');
  click(find(view.renderSettings({}), 'interval-min'));
  await drain();
  assert.equal(view.settings.interval_value, 24);
  assert.equal(view.settings.interval_unit, 'hr');
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
    return { count: 3, settings: { ...view.settings, prepared_updates_count: 3 }, errors: [] };
  };
  await view.checkOverdue(context(true));
  assert.equal(values.get('mods-plus.updates').count, 3);
  assert.match(textOf(find([view.renderEntry({})], 'plugins')), /Plugins\s+3/);
  assert.equal(view.checking, false);
  view.acceptSettings({ prepared_updates_count: 0 });
  assert.doesNotMatch(textOf(find([view.renderEntry({})], 'plugins')), /3/);
});

test('input blur and unit click save the final pair once', async () => {
  const { view, click, drain, context } = setup();
  const requests = [];
  view.helper = async args => { requests.push(args); return { ...view.settings,
    interval_value: Number(args[2]), interval_unit: args[4] }; };
  view.intervalInput.set_value('15');
  const cx = context();
  view.intervalInput.events.blur({}, cx);
  cx.valid = false;
  click(find(view.renderSettings({}), 'interval-min'));
  await drain();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].join(' '), 'settings --interval-value 15 --interval-unit min');
  assert.equal(view.intervalDirty, false);
});

test('invalid interval does not write settings and can be corrected', async () => {
  const { view, click, drain } = setup();
  let writes = 0;
  view.helper = async args => { writes++; return { ...view.settings,
    interval_value: Number(args[2]), interval_unit: args[4] }; };
  for (const text of ['', '0', '-2', '1.5', 'abc']) {
    view.intervalInput.set_value(text);
    click(find(view.renderSettings({}), 'interval-min'));
    await drain();
    assert.match(view.intervalError, /positive whole number/);
  }
  assert.equal(writes, 0);
  view.intervalInput.set_value('45');
  click(find(view.renderSettings({}), 'interval-min'));
  await drain();
  assert.equal(writes, 1);
  assert.equal(view.intervalError, null);
});

test('home Update all covers both kinds regardless of filters, blocks duplicate clicks and refreshes badges', async () => {
  const { view, click, drain, values, context } = setup();
  view.view = 'catalog';
  view.query = 'no matching cards';
  view.tab = 'layout';
  view.filter = 'not_installed';
  view.packages = [{ ...importedPackage, installed: true, has_update: true }];
  let calls = 0;
  view.helper = async args => {
    calls++;
    assert.deepEqual(Array.from(args), ['update-all']);
    await Promise.resolve();
    return { ok: true, updated: ['owner/repo/one', 'owner/repo/two'], errors: [], needs_agent: false,
      settings: { ...view.settings, prepared_updates_count: 0, prepared_update_ids: [] } };
  };
  const button = find([view.render(context())], 'update-all');
  assert.equal(textOf(button), 'Update all');
  click(button); click(button);
  await drain();
  assert.equal(calls, 1);
  assert.match(view.message, /Updated all 2/);
  assert.equal(view.busy, null);
  assert.equal(values.get('mods-plus.updates').count, 0);
  assert.equal(view.packages[0].has_update, false);
  assert.equal(view.query, 'no matching cards');
  assert.equal(view.tab, 'layout');
  assert.equal(view.filter, 'not_installed');
});

test('bulk prompt, clipboard failure, partial errors and empty results are distinguished', async () => {
  const { view, context } = setup();
  const result = { updated: [], errors: [], settings: { ...view.settings, prepared_update_ids: ['one', 'two'], prepared_updates_count: 2 },
    needs_agent: true, pending: ['one', 'two'], copied: true, prompt_path: '/fixture/update-prompt.txt' };
  view.helper = async () => result;
  await view.updateAll(context(true));
  assert.match(view.message, /Full update prompt copied for 2/);
  assert.doesNotMatch(view.message, /Updated all|up to date/);
  result.copied = false;
  await view.updateAll(context(true));
  assert.match(view.message, /Could not copy.*\/fixture\/update-prompt.txt/);
  result.needs_agent = false;
  result.updated = ['one'];
  result.errors = [{ id: 'two', error: 'offline' }];
  await view.updateAll(context(true));
  assert.match(view.message, /Updated 1 package.*two: offline/);
  result.updated = [];
  result.errors = [];
  await view.updateAll(context(true));
  assert.match(view.message, /up to date/);
  view.helper = async () => { throw new Error('update-all: Task exceeded deadline'); };
  await view.updateAll(context(true));
  assert.match(view.message, /Task exceeded deadline/);
  assert.equal(view.busy, null);
});
