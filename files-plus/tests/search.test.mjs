import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { runtime, find } from "./runtime.mjs";

async function file(root, relative, text = relative) {
  const target = path.join(root, relative);
  await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, text);
  return target;
}
async function panelFor(r) {
  const { default: Files } = await r.load("main.js");
  const panel = new Files(); panel.init({}, r.cx); await r.drain(); return panel;
}
async function query(r, panel, text) {
  panel.search.input.set_value(text);
  panel.search.input.handlers.change({}, r.cx);
  await r.advance(180);
  return panel.search.results;
}
const json = value => JSON.parse(JSON.stringify(value));

test("path search reaches unopened deep folders and entries beyond the tree cap without expanding them", async t => {
  const r = await runtime(t);
  await Promise.all(Array.from({ length: 505 }, (_, n) => file(r.dir, `a-${String(n).padStart(3, "0")}.txt`)));
  const deep = [...Array(42).fill("nested"), "Report.TXT"].join("/");
  const expected = await file(r.dir, `z-unopened/${deep}`);
  const panel = await panelFor(r), folders = [...panel.folders], entries = json([...panel.entries]);
  assert.equal(panel.entries.get(r.dir).length, 500);
  const found = await query(r, panel, "NESTED/report .txt");
  assert.equal(found.length, 1); assert.equal(found[0].path, expected); assert.equal(found[0].root, r.dir);
  assert.deepEqual([...panel.folders], folders); assert.deepEqual(json([...panel.entries]), entries);
  assert.equal(panel.search.truncated, false);
});

test("search keeps logical aliases, literal terms, hidden and ignored names, and skips .git and directory links", async t => {
  const r = await runtime(t), { searchFiles } = await r.load("search.js"), { directory } = await r.load("workspace.js");
  const root = path.join(r.dir, "real"), alias = path.join(r.dir, "logical");
  await file(root, ".hidden/odd[*]?\nname.TXT"); await file(root, ".git/secret.txt");
  await file(root, "nested/.git/secret.txt"); await file(root, "node_modules/ignored.txt");
  await file(root, ".gitignore", "node_modules\n"); await fs.symlink(root, alias); await fs.symlink(root, path.join(root, "loop"));
  const search = async q => searchFiles([{ path: alias }], null, q, directory);
  const found = await search("ODD[*]? name.txt");
  assert.equal(found.results.length, 1); assert.equal(found.results[0].root, alias);
  assert.equal(found.results[0].path, path.join(alias, ".hidden/odd[*]?\nname.TXT"));
  assert.equal((await search("secret")).results.length, 0);
  assert.equal((await search("node_modules ignored")).results.length, 1);
  assert.equal((await search("loop")).results[0].relative, "loop");
  assert.equal((await search("loop/name")).results.length, 0);
});

test("multi-root duplicate paths retain root identity and focus movement does not replace the search", async t => {
  const r = await runtime(t), roots = [path.join(r.dir, "web"), path.join(r.dir, "api")];
  for (const root of roots) await file(root, "src/same.txt");
  r.shared["multi-root.spaces"] = { s1: { folders: roots.map(root => ({ path: root, name: "Project" })) } };
  const panel = await panelFor(r), found = await query(r, panel, "src/same");
  assert.deepEqual(Array.from(found, result => result.root), roots); assert.equal(new Set(found.map(result => result.key)).size, 2);
  const { rootContexts } = await r.load("search.js"), labels = rootContexts(panel.search.roots);
  assert.equal(labels.get(roots[0]), roots[0]); assert.equal(labels.get(roots[1]), roots[1]);
  const searchView = panel.render(r.cx);
  for (const hit of found) {
    const row = find(searchView, `search-${hit.key}`), secondary = row.nodes[1].nodes[1];
    assert.deepEqual(secondary.nodes.map(label => label.nodes[0]), [hit.root, "/", "src/same.txt"]);
  }
  const request = panel.search.request;
  r.focus.cwd = roots[1]; r.panes[0].cwd = roots[1]; panel.render(r.cx); await r.drain();
  assert.equal(panel.search.request, request); assert.equal(panel.search.results, found);
  assert.ok(find(panel.render(r.cx), "files-search-results"));
});

test("only an extra match marks results as truncated and directory errors keep successful roots visible", async t => {
  const r = await runtime(t), { searchFiles, SEARCH_LIMIT } = await r.load("search.js");
  const listing = n => Array.from({ length: n }, (_, i) => ({ name: `file-${i}.txt`, dir: false }));
  const exact = await searchFiles([{ path: "/ok" }], null, ".txt", async () => listing(SEARCH_LIMIT));
  assert.equal(exact.results.length, SEARCH_LIMIT); assert.equal(exact.truncated, false);
  const excess = await searchFiles([{ path: "/ok" }], null, ".txt", async () => listing(SEARCH_LIMIT + 1));
  assert.equal(excess.results.length, SEARCH_LIMIT); assert.equal(excess.truncated, true);
  const failed = await searchFiles([{ path: "/bad" }, { path: "/ok" }], null, ".txt", async root => {
    if (root === "/bad") throw new Error("Access denied"); return listing(1);
  });
  assert.equal(failed.results.length, 1); assert.equal(failed.failures, 1); assert.match(failed.errors[0], /Access denied/);
});

test("filename ranks beat earlier path matches even when the display cap is full", async t => {
  const r = await runtime(t), { searchFiles, SEARCH_LIMIT } = await r.load("search.js");
  const files = names => names.map(name => ({ name, dir: false }));
  const listings = new Map([
    ["/early", [{ name: "report", dir: true }]],
    ["/early/report", files(Array.from({ length: SEARCH_LIMIT + 5 }, (_, i) => `archive-${i}.txt`))],
    ["/late", [{ name: "src", dir: true }]],
    ["/late/src", files(["monthly-report.txt", "report-notes.md", "Report.md", "REPORT"])]
  ]);
  const found = await searchFiles([{ path: "/early" }, { path: "/late" }], null, "report", async dir => listings.get(dir));
  assert.equal(found.results.length, SEARCH_LIMIT);
  assert.deepEqual(Array.from(found.results.slice(0, 5), hit => hit.relative),
    ["src/REPORT", "src/Report.md", "src/report-notes.md", "src/monthly-report.txt", "report/archive-0.txt"]);
  assert.equal(found.truncated, true);
  assert.equal(found.scanLimited, false);
});

test("initials and compact fuzzy matches rank naturally while Unicode and multi-word paths stay literal", async t => {
  const r = await runtime(t), { searchFiles } = await r.load("search.js");
  const accented = "Su\u0301per File.ts";
  const files = ["FilePanelController.ts", "file_panel_controller-extra.ts", "alpha-fXpc.ts", "flab-paaab-aCoo.ts", "FilePanel.css", accented];
  const list = async dir => dir === "/root" ? [{ name: "Sources", dir: true }] : files.map(name => ({ name, dir: false }));
  const search = text => searchFiles([{ path: "/root" }], null, text, list);
  assert.deepEqual(Array.from((await search("fpc")).results, hit => hit.relative),
    ["Sources/FilePanelController.ts", "Sources/file_panel_controller-extra.ts", "Sources/alpha-fXpc.ts", "Sources/flab-paaab-aCoo.ts"]);
  assert.equal((await search("SÚPER FILE.TS")).results[0].relative, `Sources/${accented}`);
  assert.equal((await search(".ts SOURCES/SÚPER file")).results[0].relative, `Sources/${accented}`);
  assert.equal((await search("sources/fpc")).results.length, 0);
});

test("entry and folder budgets disclose partial scans, independently of the display cap", async t => {
  const r = await runtime(t), panel = await panelFor(r);
  const { searchFiles, SEARCH_SCAN_LIMIT, SEARCH_FOLDER_LIMIT } = await r.load("search.js");
  const entries = Array.from({ length: SEARCH_SCAN_LIMIT }, (_, i) => ({ name: `filler-${i}.txt`, dir: false }));
  const roots = [{ path: "/root" }];
  const exact = await searchFiles(roots, null, "needle.txt", async () => entries);
  assert.equal(exact.scanLimited, false);
  panel.search.list = async (_folder, _on, limit) => {
    assert.equal(limit, SEARCH_SCAN_LIMIT);
    return [...entries, { name: "needle.txt", dir: false }];
  };
  assert.equal((await query(r, panel, "needle.txt")).length, 0);
  assert.equal(panel.search.truncated, false);
  assert.equal(panel.search.scanLimited, true);
  const view = panel.render(r.cx);
  assert.match(find(view, "files-search-error").nodes[0], /scan limit reached/);
  assert.equal(find(view, "files-search-empty"), null);

  let calls = 0;
  const directories = Array.from({ length: SEARCH_FOLDER_LIMIT }, (_, i) => ({ name: `child-${i}`, dir: true }));
  const folders = await searchFiles(roots, null, "needle.txt", async dir => {
    calls++;
    return dir === "/root" ? directories : [];
  });
  assert.equal(calls, SEARCH_FOLDER_LIMIT);
  assert.equal(folders.scanLimited, true);
  assert.equal(folders.truncated, false);
});

test("new queries supersede delayed results, and clearing cannot resurrect an in-flight query", async t => {
  const r = await runtime(t); await file(r.dir, "new.txt"); const panel = await panelFor(r);
  const started = Promise.withResolvers(), release = Promise.withResolvers();
  const list = panel.search.list; let once = true;
  panel.search.list = async (...args) => { if (once) { once = false; started.resolve(); await release.promise; return [{ name: "old.txt", dir: false }]; } return list(...args); };
  panel.search.setQuery("old", r.cx); const old = r.advance(180); await started.promise;
  const inFlight = panel.search.request;
  panel.refresh(r.cx, { recover: true });
  assert.equal(panel.search.request, inFlight, "safety polls must allow a slow search to finish");
  await query(r, panel, "new"); assert.equal(panel.search.results[0].relative, "new.txt");
  release.resolve(); await old; assert.equal(panel.search.results[0].relative, "new.txt");
  const pending = Promise.withResolvers(), reading = Promise.withResolvers();
  panel.search.list = async () => { reading.resolve(); await pending.promise; return [{ name: "late.txt", dir: false }]; };
  panel.search.setQuery("late", r.cx); const last = r.advance(180); await reading.promise;
  panel.search.clear(r.cx); pending.resolve(); await last;
  assert.equal(panel.search.active, false); assert.equal(panel.search.results.length, 0); assert.equal(panel.search.busy, false);
});

test("root changes reject queued clicks and delayed replies, then re-run the same query on current roots", async t => {
  const r = await runtime(t), first = path.join(r.dir, "first"), next = path.join(r.dir, "next");
  await file(first, "same.txt"); await file(next, "same.txt");
  r.focus.cwd = first; r.panes[0].cwd = first;
  const panel = await panelFor(r); await query(r, panel, "same");
  const staleKey = panel.search.results[0].key;
  r.focus.cwd = next; r.panes[0].cwd = next; r.calls = [];
  panel.search.open(staleKey, r.cx); assert.equal(r.calls.length, 0);
  panel.render(r.cx); await r.drain(); await r.advance(180);
  assert.equal(panel.search.query, "same"); assert.equal(panel.search.results[0].root, next);
  panel.search.open(staleKey, r.cx); await r.drain(); assert.ok(!r.calls.some(call => call.command === "tab.new"));

  const reading = Promise.withResolvers(), release = Promise.withResolvers(), list = panel.search.list;
  panel.search.list = async (...args) => { if (args[0] === next) { reading.resolve(); await release.promise; } return list(...args); };
  panel.search.refresh(r.cx); const pending = r.advance(180); await reading.promise;
  r.shared["multi-root.spaces"] = { s1: { folders: [{ path: first }] } };
  panel.render(r.cx); await r.drain(); await r.advance(180);
  assert.equal(panel.search.results[0].root, first);
  release.resolve(); await pending; assert.equal(panel.search.results[0].root, first);
});

test("no-folder, empty, partial and unavailable searches have distinct visible states", async t => {
  const r = await runtime(t), panel = await panelFor(r);
  await query(r, panel, "absent");
  assert.ok(find(panel.render(r.cx), "files-search-empty")); assert.equal(find(panel.render(r.cx), "files-search-error"), null);
  panel.search.list = async () => { throw new Error("Permission denied"); };
  panel.search.refresh(r.cx); await r.advance(180);
  assert.ok(find(panel.render(r.cx), "files-search-error")); assert.equal(find(panel.render(r.cx), "files-search-empty"), null);
  r.spaces[0].active = false; r.focus = null; panel.render(r.cx); await r.drain();
  assert.deepEqual(find(panel.render(r.cx), "files-search-status").nodes, ["No folder"]);
});

test("selection, submit and pointer opens preserve Tab, Pane and internal behavior; Escape and Clear restore expansion", async t => {
  const r = await runtime(t); await file(r.dir, "nested/a.txt", "A"); await file(r.dir, "nested/b.txt", "B");
  const panel = await panelFor(r); panel.toggle(path.join(r.dir, "nested"), r.cx); await r.drain();
  const folders = [...panel.folders], tree = panel.treeView;
  await query(r, panel, "nested .txt");
  find(panel.render(r.cx), "files-search-bar").handlers.on_key_down({ key: "down" }, r.cx);
  assert.equal(panel.search.at, 1); assert.equal(panel.search.scroll.index, 1);
  panel.search.input.handlers.submit({}, r.cx); await r.drain();
  let opened = r.calls.findLast(call => call.command === "tab.new");
  assert.equal(opened.args.props.file, path.join(r.dir, "nested/b.txt")); assert.equal(opened.args.props.root, r.dir);
  r.shared["files-plus.open-location"] = "pane";
  find(panel.render(r.cx), "files-search-results").handlers.on_item_click(panel.search.results[0].key, r.cx); await r.drain();
  opened = r.calls.findLast(call => call.command === "pane.split");
  assert.equal(opened.args.pane, "p1"); assert.equal(opened.args.props.file, path.join(r.dir, "nested/a.txt"));
  r.shared["files-plus.open-location"] = "internal";
  panel.search.input.handlers.submit({}, r.cx); await r.drain(); assert.equal(panel.code.value, "A");
  find(panel.render(r.cx), "files-back").handlers.on_click({}, r.cx);
  find(panel.render(r.cx), "files-search-bar").handlers.on_key_down({ key: "escape" }, r.cx);
  assert.equal(panel.search.query, ""); assert.equal(panel.treeView, tree); assert.deepEqual([...panel.folders], folders);
  assert.ok(find(panel.render(r.cx), "files-tree"));
  await query(r, panel, "a.txt"); find(panel.render(r.cx), "files-search-clear").handlers.on_click({}, r.cx);
  assert.deepEqual([...panel.folders], folders); assert.equal(panel.search.active, false);
});

test("same paths on different machines are separate targets and remote listings/opening carry on", async t => {
  const r = await runtime(t), { searchFiles } = await r.load("search.js"), list = async () => [{ name: "same.txt", dir: false }];
  const local = await searchFiles([{ path: "/root" }], null, "same", list);
  const remote = await searchFiles([{ path: "/root" }], "server", "same", list);
  assert.notEqual(local.results[0].key, remote.results[0].key);
  await file(r.dir, "same.txt");
  const panel = await panelFor(r); await query(r, panel, "same");
  const old = panel.search.results[0], started = Promise.withResolvers(), release = Promise.withResolvers();
  panel.search.list = async (...args) => {
    if (args[1] === null) { started.resolve(); await release.promise; }
    return (await r.load("workspace.js")).directory(...args);
  };
  r.spaces[0].machine = "server"; r.calls = [];
  panel.search.open(old.key, r.cx);
  panel.treeKey({ key: "f6" }, r.cx);
  panel.treeKey({ key: "f7" }, r.cx);
  assert.deepEqual(r.calls, []);

  r.spaces[0].machine = null;
  panel.search.refresh(r.cx);
  const pending = r.advance(180); await started.promise;
  r.spaces[0].machine = "server"; panel.refresh(r.cx);
  await r.advance(180);
  assert.equal(panel.search.results[0].on, "server");
  assert.notEqual(panel.search.results[0].key, old.key);
  assert.ok(r.calls.filter(call => call.command === "sh").every(call => call.on === "server"));
  release.resolve(); await pending;
  assert.equal(panel.search.results[0].on, "server", "a late same-path local reply cannot replace remote results");
  panel.search.open(panel.search.results[0].key, r.cx); await r.drain();
  assert.equal(r.calls.findLast(call => call.command === "tab.new").args.props.on, "server");
});

test("Enter and F6 preview the ranked selection, with pins protected and F7 inserting the selected reference", async t => {
  const r = await runtime(t), exact = await file(r.dir, "src/Report.txt"), other = await file(r.dir, "other/Report notes.txt");
  await fs.mkdir(path.join(r.dir, "app/mods/preview-plus"), { recursive: true });
  await fs.writeFile(path.join(r.dir, "app/mods/preview-plus/mod.json"), "{}");
  r.props = { previewStack: "files" };
  const panel = await panelFor(r);
  await query(r, panel, "report");
  assert.equal(panel.search.results[0].path, exact);
  panel.search.input.handlers.submit({}, r.cx); await r.drain();
  const paired = r.shared["preview-plus.target"].s1;
  assert.equal(paired.file, exact);
  r.shared["preview-plus.pinned"] = { s1: paired };
  panel.search.key({ key: "down" }, r.cx);
  panel.treeKey({ key: "f6" }, r.cx); await r.drain();
  assert.equal(r.shared["preview-plus.target"].s1, paired);
  assert.match(r.calls.findLast(call => call.command === "notify").spec.title, /Preview is pinned/);
  panel.treeKey({ key: "f7" }, r.cx); await r.drain();
  assert.equal(r.pasted, '@"other/Report notes.txt" ');
  assert.equal(r.clipboard, "original clipboard");
  delete r.shared["preview-plus.pinned"];
  panel.treeKey({ key: "f6" }, r.cx); await r.drain();
  assert.equal(r.shared["preview-plus.target"].s1.file, other);
});

test("watch changes under unopened directories refresh search and .git lock churn does not", async t => {
  const r = await runtime(t); const expected = await file(r.dir, "unopened/one.txt");
  const panel = await panelFor(r); await query(r, panel, "unopened");
  await fs.unlink(expected); await file(r.dir, "unopened/two.txt");
  panel.queueChanges([expected], r.cx); await r.advance(200); await r.advance(180);
  assert.equal(panel.search.results.length, 1); assert.equal(panel.search.results[0].relative, "unopened/two.txt");
  const request = panel.search.request;
  panel.queueChanges([path.join(r.dir, ".git/index.lock")], r.cx); await r.advance(200);
  assert.equal(panel.search.request, request); assert.ok(!panel.folders.has(path.join(r.dir, "unopened")));
});

test("closing releases search resources and cancels delayed replies", async t => {
  const r = await runtime(t), panel = await panelFor(r), started = Promise.withResolvers(), release = Promise.withResolvers();
  panel.search.list = async () => { started.resolve(); await release.promise; return [{ name: "late.txt", dir: false }]; };
  panel.search.setQuery("late", r.cx); const pending = r.advance(180); await started.promise;
  panel.close(); release.resolve(); await pending;
  assert.equal(panel.search.results.length, 0); assert.equal(panel.search.input.released, true); assert.equal(panel.search.scroll.released, true);
});

test("Windows search bounds literal directory reads and preserves path spelling", async t => {
  const r = await runtime(t), { directory } = await r.load("workspace.js"), { searchFiles } = await r.load("search.js");
  r.platform = "windows";
  r.hooks.exec = async (cmd, args) => {
    assert.equal(cmd, "powershell"); assert.match(args[3], /Select-Object -First \d+/);
    assert.ok(args[3].includes("-LiteralPath")); assert.ok(args[3].includes("ReparsePoint"));
    return { code: 0, stdout: JSON.stringify(args.at(-1) === "C:/Project" ? [{ name: "src", dir: true }] : [{ name: "中文 [file].txt", dir: false }]), stderr: "" };
  };
  const result = await searchFiles([{ path: "C:/Project" }], null, "SRC/ [file]", directory);
  assert.equal(result.results[0].path, "C:/Project/src/中文 [file].txt");
});
