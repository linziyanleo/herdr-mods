import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { runtime, find, until } from "./runtime.mjs";
import { FIND_LIMIT, literalMatches, sourceRange, typedLocation } from "../mods/preview-plus/source-location.js";

const click = (r, id) => find(r.render(), id).handlers.on_click({}, r.cx);
const selection = code => ({ ...code.selected_range() });
const cursor = offset => ({ start: offset, end: offset });
const open = async (r, props) => { r.props = props; await r.start(); r.render(); await r.settle(); return r.panel; };
async function command(r, target) {
  r.dispatch("locate:" + encodeURIComponent(JSON.stringify(target)));
  await new Promise(resolve => setImmediate(resolve));
  r.render();
  await new Promise(resolve => setImmediate(resolve));
}

test("coordinates count code points and map to UTF-16 including CRLF and combining marks", () => {
  const text = "中😀e\u0301\r\n\r\n\tlast\n";
  assert.deepEqual(sourceRange(text, { line: 1, column: 3, expectedLine: "中😀e\u0301", match: "e\u0301" }).range, { start: 3, end: 5 });
  assert.deepEqual(sourceRange(text, { line: 1, column: 5 }).range, cursor(5));
  assert.deepEqual(sourceRange(text, { line: 2 }).range, cursor(7));
  assert.deepEqual(sourceRange(text, { line: 3, column: 2 }).range, cursor(10));
  assert.deepEqual(sourceRange(text, { line: 4 }).range, cursor(text.length));
  assert.deepEqual(sourceRange("", { line: 1 }).range, cursor(0));
  assert.match(sourceRange(text, { line: 1, column: 6 }).error, /Column/);
  assert.match(sourceRange(text, { line: 5 }).error, /Line/);
  assert.match(sourceRange(text, typedLocation("0")).error, /positive/);
  assert.match(sourceRange(text, typedLocation("1:999999999999999999999")).error, /positive/);
  assert.equal(typedLocation(""), null);
  assert.equal(typedLocation("1:"), null);
  assert.match(sourceRange("partial", { line: 1, expectedLine: "partial", match: "part" }, true).error, /verified/);
  assert.match(sourceRange(text, { line: 1, column: 2, match: "\uD83D", expectedLine: "中😀e\u0301" }).error, /match/);
});

test("find is literal, case-sensitive, non-overlapping, and reports the cap only when exceeded", () => {
  assert.deepEqual(literalMatches(".* .X .*", ".*").ranges, [{ start: 0, end: 2 }, { start: 6, end: 8 }]);
  assert.deepEqual(literalMatches("ＡaA", "A").ranges, [{ start: 2, end: 3 }]);
  assert.equal(literalMatches("aaaaa", "aa").ranges.length, 2);
  assert.deepEqual(literalMatches("", ""), { ranges: [], limited: false });
  assert.equal(literalMatches("a".repeat(FIND_LIMIT), "a").limited, false);
  const capped = literalMatches("a".repeat(FIND_LIMIT + 1), "a");
  assert.equal(capped.limited, true);
  assert.equal(capped.ranges.length, FIND_LIMIT);
});

test("toolbar Go and Find navigate the current draft, preserve the editor and return focus", async t => {
  const r = await runtime(t), file = path.join(r.dir, "source.txt");
  await fs.writeFile(file, "Disk");
  const p = await open(r, { file }), code = p.code, draft = "中😀.*\r\nLine\r\n😀.*";
  r.edit(draft);
  click(r, "preview-go-to"); await until(() => r.keyboard === p.goInput);
  p.goInput.handlers.submit({}, r.cx);
  assert.match(find(r.render(), "preview-location-error").nodes[0], /positive/);
  p.goInput.set_value("3:2");
  p.goInput.handlers.submit({}, r.cx);
  assert.deepEqual(selection(code), cursor(draft.lastIndexOf(".*")));
  assert.equal(r.keyboard, code);

  click(r, "preview-find"); await until(() => r.keyboard === p.findInput);
  const query = text => { p.findInput.set_value(text); p.findInput.handlers.change({}, r.cx); };
  const count = () => find(r.render(), "preview-find-count").nodes[0];
  query("nothing"); assert.equal(count(), "0 matches");
  assert.equal(find(r.render(), "preview-find-next").handlers.on_click, undefined);
  query(".*"); assert.equal(count(), "1 / 2");
  assert.equal(draft.slice(...Object.values(selection(code))), ".*");
  click(r, "preview-find-previous"); assert.equal(count(), "2 / 2");
  assert.equal(code.selected_range().start, draft.lastIndexOf(".*"));
  p.findInput.handlers.submit({}, r.cx); assert.equal(count(), "1 / 2");
  p.keyDown({ key: "escape", keystroke: "escape" }, r.cx);
  assert.equal(r.keyboard, code);
  assert.equal(find(r.render(), "preview-navigation-input"), null);
  assert.equal(p.code, code);
  assert.equal(p.dirty(), true);
  assert.equal(await fs.readFile(file, "utf8"), "Disk");
});

test("fixed props position is one-shot and explicit reuse keeps the draft and rejects wrong identities", async t => {
  const r = await runtime(t), file = path.join(r.dir, "source.md"), text = "# first\r\n中😀match\r\nlast";
  const target = { space: "s1", tab: "t1", file, on: null, viewer: "fixed" };
  r.focus.tab = target.tab;
  await fs.writeFile(file, text);
  let p = await open(r, { ...target, location: { line: 2, column: 3 } });
  const code = p.code;
  assert.equal(p.source, true);
  assert.deepEqual(selection(code), cursor(text.indexOf("match")));
  code.set_selected_range(cursor(0));
  r.render(); await r.settle();
  assert.deepEqual(selection(code), cursor(0));
  r.edit("my draft\r\n" + text);
  for (const other of [{ viewer: "another" }, { space: "s2" }, { tab: "another" }, { on: "remote" }, { file: file + "other" }]) {
    await command(r, { ...target, ...other, location: { line: 3, column: 3 } });
    assert.deepEqual(selection(code), cursor(0));
  }
  await command(r, { ...target, location: { line: 2, column: 3, expectedLine: "中😀match", match: "match" } });
  assert.match(p.locationError, /verified/);
  assert.deepEqual(selection(code), cursor(0));
  await command(r, { ...target, location: { line: 3, column: 3, expectedLine: "中😀match", match: "match" } });
  assert.deepEqual(selection(code), { start: p.text.indexOf("match"), end: p.text.indexOf("match") + 5 });
  assert.equal(p.code, code); assert.ok(p.dirty());
  assert.equal(await fs.readFile(file, "utf8"), text);
  await p.close();
  p = await open(r, r.props);
  assert.equal(p.source, false);
  assert.deepEqual(selection(p.code), cursor(0));
  assert.ok(p.dirty());
});

test("paired location waits for the latest A-B-A selection and respects machine, workspace and pins", async t => {
  const r = await runtime(t), file = path.join(r.dir, "slow.txt"), other = path.join(r.dir, "other.txt");
  const scope = { space: "s1", tab: "t1", stack: "paired" };
  r.focus.tab = scope.tab;
  const reads = [];
  r.hooks.read = (file, options) => new Promise(resolve => reads.push({ file, on: options?.on, resolve }));
  const p = await open(r, { previewStack: scope.stack });
  const incoming = (file, on, id, space = scope.space) => {
    (r.shared["preview-plus.target"] ||= {})[space] = { file, on, selection: id };
    r.render();
  };
  const send = (file, on, id, line, extra = {}) => command(r, { ...scope, file, on, selection: id, location: { line }, ...extra });
  incoming(file, null, "a1"); await send(file, null, "a1", 2);
  incoming(other, null, "b1"); await send(other, null, "b1", 2);
  incoming(file, "remote", "a2"); await send(file, "remote", "a2", 3);
  await send(file, null, "a2", 1);
  await send(file, "remote", "a1", 1);
  await send(file, "remote", "a2", 1, { space: "s2" });
  assert.deepEqual(reads.map(read => [read.file, read.on]), [[file, null], [other, null], [file, "remote"]]);
  reads[2].resolve("a\r\nb\r\nc"); await r.settle(); r.render(); await r.settle();
  assert.equal(p.code.readonly, true);
  assert.deepEqual(selection(p.code), cursor(6));
  reads[0].resolve("Old A"); reads[1].resolve("Old B");
  await r.settle(); assert.equal(p.code.value(), "a\r\nb\r\nc");
  p.togglePin(r.cx); r.render();
  incoming(other, "remote", "b2"); await send(other, "remote", "b2", 1);
  assert.equal(p.selected.file, file); assert.equal(reads.length, 3);
  incoming(file, "remote", "a3"); await send(file, "remote", "a3", 2);
  assert.deepEqual(selection(p.code), cursor(3));

  r.spaces.push({ id: "s2", folder: r.dir, machine: "remote" });
  r.focus.space = "s2"; r.focus.tab = "t2";
  incoming(file, "remote", "a3", "s2");
  await send(file, "remote", "a3", 2);
  reads[3].resolve("a\r\nb\r\nc"); await r.settle(); r.render();
  assert.deepEqual(selection(p.code), cursor(0));
  await send(file, "remote", "a3", 2, { space: "s2", tab: "t2" });
  assert.deepEqual(selection(p.code), cursor(3));
});

test("truncated source finds only visible file content and keeps read-only behavior", async t => {
  const r = await runtime(t), file = path.join(r.dir, "partial.txt");
  await fs.writeFile(file, "x".repeat(399999) + "😀unseen");
  const p = await open(r, { file, location: { line: 2 } });
  assert.ok(p.code.readonly && p.truncated);
  assert.equal(p.sourceText().length, 399999);
  assert.match(p.locationError, /outside/);
  click(r, "preview-find");
  p.findInput.set_value("file truncated"); p.findInput.handlers.change({}, r.cx);
  assert.equal(find(r.render(), "preview-find-count").nodes[0], "0 matches");
  p.findInput.set_value("x"); p.findInput.handlers.change({}, r.cx);
  assert.equal(find(r.render(), "preview-find-count").nodes[0], "1 / 1000+");
});

test("a same-file reopen during the read supersedes its old position without losing the read", async t => {
  const r = await runtime(t), file = path.join(r.dir, "slow.txt");
  const scope = { space: "s1", tab: "t1", stack: "paired" };
  r.focus.tab = scope.tab;
  let finish, reads = 0;
  r.hooks.read = () => new Promise(resolve => { reads++; finish = resolve; });
  const p = await open(r, { previewStack: scope.stack });
  const first = { file, on: null, selection: "old" };
  r.shared["preview-plus.target"] = { s1: first };
  r.render();
  await command(r, { ...scope, ...first, location: { line: 2 } });
  const second = { ...first, selection: "new" };
  r.shared["preview-plus.target"].s1 = second;
  finish("first\nsecond\nthird");
  await r.settle();
  r.render(); await r.settle();
  assert.equal(reads, 1);
  assert.deepEqual(selection(p.code), cursor(0));
  await command(r, { ...scope, ...second, location: { line: 3 } });
  assert.deepEqual(selection(p.code), cursor(13));
});
