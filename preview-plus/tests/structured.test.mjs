import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { runtime, find, until } from "./runtime.mjs";

const plain = value => JSON.parse(JSON.stringify(value));
const virtual = element => element?.kind === "uniform-list" ? element : (element?.nodes || []).map(virtual).find(Boolean);

test("JSON rows preserve pointer identity, primitives and bounded deep/wide trees", async t => {
  const state = await runtime(t), { jsonRows, structuredPreview, LIMITS } = await state.load("structured.js");
  const value = structuredPreview("json", '\uFEFF{"a/b":{"~":[null,true,2]},"__proto__":"safe","empty":{}}').value;
  let result = jsonRows(value, new Set(["", "/a~1b", "/a~1b/~0"]));
  assert.deepEqual(Array.from(result.rows, row => row.path), ["", "/a~1b", "/a~1b/~0", "/a~1b/~0/0", "/a~1b/~0/1", "/a~1b/~0/2", "/__proto__", "/empty"]);
  assert.equal(result.rows.at(-1).expandable, false);
  assert.equal(jsonRows(false, new Set()).rows[0].text, "false");
  assert.equal(jsonRows(null, new Set()).rows[0].text, "null");
  result = jsonRows(Array(11000).fill(1), new Set([""]));
  assert.equal(result.rows.length, LIMITS.rows); assert.equal(result.truncated, true);
  let deep = null; const expanded = new Set([""]); let location = "";
  for (let i = 0; i < 100; i++) { deep = { child: deep }; location += "/child"; expanded.add(location); }
  result = jsonRows(deep, expanded);
  assert.equal(result.rows.length, LIMITS.depth + 1); assert.equal(result.truncated, true); assert.equal(result.rows.at(-1).expandable, false);
  assert.match(structuredPreview("json", '{"broken":}').error, /JSON|Unexpected/);
  assert.match(structuredPreview("json", "{}", true).error, /truncated/);
});

test("delimited parsing handles BOM, quotes, newlines, trailing empties and rejects malformed fields", async t => {
  const state = await runtime(t), { parseDelimited, delimiterOf } = await state.load("structured.js");
  assert.deepEqual(plain(parseDelimited('\uFEFFname,note,empty\r\nAda,"one,\n""two""",\r\n', ",").rows), [["name", "note", "empty"], ["Ada", 'one,\n"two"', ""]]);
  assert.deepEqual(plain(parseDelimited('""', ",").rows), [[""]]);
  assert.deepEqual(plain(parseDelimited("", ",").rows), []);
  assert.deepEqual(plain(parseDelimited("a\tb\r1\t2", "\t").rows), [["a", "b"], ["1", "2"]]);
  assert.equal(delimiterOf("csv", '"x;y;z",b\n1,2'), ",");
  assert.equal(delimiterOf("csv", '"x,y";b\n1;2'), ";");
  for (const bad of ['a,"unclosed', 'a,"closed"oops', 'a,b"c']) assert.throws(() => parseDelimited(bad, ","), /quote|quoted/);
  const bounded = parseDelimited("a,b,c\n1,2,3\n4,5,6", ",", { rows: 2, columns: 2 });
  assert.deepEqual(plain(bounded.rows), [["a", "b"], ["1", "2"]]); assert.equal(bounded.truncated, true);
});

for (const [ext, original, edited] of [["json", '{"items":[1,2]}', '{"items":[1,2,3]}'], ["csv", 'name,value\nA,"x,y"', 'name,value\nB,"x,y"'], ["tsv", "name\tvalue\nA\t1", "name\tvalue\nB\t2"]]) {
  test(`${ext} pane preview edits only source, retains drafts, detects save conflicts and restores after navigation`, async t => {
    const state = await runtime(t), file = path.join(state.dir, "data." + ext);
    await fs.writeFile(file, original); await fs.writeFile(path.join(state.dir, "other.txt"), "other");
    state.props = { file }; const panel = await state.start();
    assert.equal(panel.owner.mode, "pane"); assert.equal(panel.source, false); assert.equal(panel.dataPreview.error, undefined);
    assert.ok(virtual(state.render())); assert.ok(find(state.render(), "preview-mode"));
    assert.equal(find(state.render(), "preview-wrap").attributes.disabled[0], true);
    const editor = panel.code; panel.setSource(true, state.cx); state.edit(edited); panel.setSource(false, state.cx);
    assert.equal(panel.code, editor); assert.equal(panel.document.text, edited); assert.equal(panel.dirty(), true);
    assert.equal(await fs.readFile(file, "utf8"), original);
    panel.follow("other.txt", state.cx); await state.settle(); panel.back(state.cx); await state.settle();
    assert.equal(panel.text, edited); assert.equal(panel.dirty(), true); assert.equal(panel.source, false);
    await fs.writeFile(file, original + "\n"); panel.save(state.cx); await until(() => !panel.document.saving);
    assert.match(panel.document.saveError, /changed/); assert.equal(panel.text, edited);
    panel.discard(state.cx); assert.equal(panel.text, edited); panel.discard(state.cx); await state.settle();
    assert.equal(panel.text, original + "\n"); assert.equal(panel.dirty(), false);
    panel.setSource(true, state.cx); state.edit(edited); panel.keyDown({ keystroke: "cmd-s" }, state.cx); await until(() => !panel.document.saving);
    assert.equal(await fs.readFile(file, "utf8"), edited); assert.equal(panel.dirty(), false);
  });
}

test("JSON collapse is a list-level action; tables render only requested rows", async t => {
  const state = await runtime(t); const file = path.join(state.dir, "tree.json"); await fs.writeFile(file, '{"a":[1,2]}');
  state.props = { file }; const panel = await state.start(); let list = virtual(state.render());
  assert.equal(list.value.count, 2); list.handlers.on_item_click("/a", state.cx);
  list = virtual(state.render()); assert.equal(list.value.count, 4);
  const rendered = list.value.render({ start: 2, end: 4 }); assert.equal(rendered.length, 2);
  list.handlers.on_item_click("/a", state.cx); assert.equal(virtual(state.render()).value.count, 2);
  const csv = path.join(state.dir, "many.csv"); await fs.writeFile(csv, "name,value\n" + Array.from({ length: 9000 }, (_, n) => `${n},v${n}`).join("\n"));
  panel.show({ file: csv }, state.cx); await state.settle(); list = virtual(state.render());
  assert.equal(list.value.count, 9001); assert.equal(list.value.render({ start: 8000, end: 8010 }).length, 10);
});

test("structured errors keep source editable; remote and truncated data cannot save", async t => {
  const state = await runtime(t); state.props = { file: "/remote/data.json", on: "remote" }; state.hooks.read = async () => '{"ok":true}';
  const panel = await state.start(); assert.equal(panel.dataPreview.value.ok, true); assert.equal(panel.document, null);
  panel.setSource(true, state.cx); assert.equal(panel.code.readonly, true); assert.equal(find(state.render(), "preview-save"), null);
  state.props = { file: path.join(state.dir, "bad.json") }; state.hooks.read = async () => '{"bad":'; state.render(); await state.settle();
  assert.ok(panel.dataPreview.error); assert.equal(panel.code.readonly, false);
  panel.setSource(true, state.cx); state.edit("null"); panel.setSource(false, state.cx); assert.equal(panel.dataPreview.value, null);
  state.props = { file: path.join(state.dir, "huge.csv") }; state.hooks.read = async () => "a".repeat(400001); state.render(); await state.settle();
  assert.match(panel.dataPreview.error, /truncated/); assert.equal(panel.document, null);
});

test("late structured reads cannot replace a newer pane target or its draft", async t => {
  const state = await runtime(t), pending = [];
  state.hooks.read = file => new Promise(resolve => pending.push({ file, resolve }));
  state.props = { previewStack: "files" }; const panel = await state.start();
  panel.show({ file: "/data/a.json" }, state.cx); await until(() => pending.length === 1);
  panel.show({ file: "/data/b.csv" }, state.cx); await until(() => pending.length === 2);
  pending[1].resolve("name,value\nnew,2"); await state.settle();
  panel.setSource(true, state.cx); state.edit("name,value\ndraft,3");
  pending[0].resolve('{"stale":true}'); await new Promise(resolve => setImmediate(resolve));
  assert.equal(panel.selected.file, "/data/b.csv"); assert.match(panel.text, /draft/); assert.equal(panel.dirty(), true);
});
