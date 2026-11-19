import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { runtime } from "./runtime.mjs";

const ok = { code: 0, stdout: "", stderr: "" };
const nextTurn = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function fixture(t) {
  const r = await runtime(t);
  const roots = Object.fromEntries(["web", "api", "docs", "other"].map(name => [name, path.join(r.dir, name)]));
  await Promise.all(Object.values(roots).map(root => fs.mkdir(root)));
  r.spaces.push({ id: "s2", name: "Other", folder: roots.other, machine: null, active: false, tabs: [{ id: "tab2", active: true }] });
  const program = { key: "codex", name: "Codex", icon: null, tint: false, tile: null, color: null, shell: false, agent: true };
  function addAgent(address, space = "s1", status = "idle") {
    const tab = space === "s1" ? "tab1" : "tab2";
    const agent = { address, pane: `p-${address}`, space, space_name: space === "s1" ? "Product" : "Other", tab, tab_index: 1, tab_name: "1", status, app: "codex", program, title: "Codex", seq: 1, focused: false };
    r.agents.push(agent);
    r.terminals.push({ address, name: address, argv: ["codex"], state: "live", status, report: { app: "codex" }, labels: { "herdr.space": space, "herdr.tab": tab }, parent: null, pid: 1000 + r.terminals.length, created_ms: 1700000000000 + r.terminals.length });
    return agent;
  }
  r.agents = [];
  r.terminals = [{ address: "t1", name: "shell", argv: ["sh"], state: "live", status: null, labels: { "herdr.space": "s1", "herdr.tab": "tab1" }, parent: null }];
  function mapping(entries) {
    const workspaces = Object.fromEntries(Object.entries(entries).map(([space, folders]) => [space, { name: space, file: null, folders: folders.map(root => ({ path: root, source: root, name: null })) }]));
    r.shared["multi-root.spaces"] = workspaces;
    return workspaces;
  }
  return { r, roots, addAgent, mapping };
}

test("existing and new agents receive additions and removals for their own workspace", async t => {
  const { r, roots, addAgent, mapping } = await fixture(t);
  const { AgentWorkspaceContext, workspaceMessage } = await r.load("agent-context.js");
  addAgent("agent-1"); addAgent("agent-2", "s1", "working"); addAgent("other", "s2");
  const context = new AgentWorkspaceContext(); t.after(() => context.close());
  let workspaces = mapping({ s1: [roots.web, roots.api], s2: [roots.other] });
  context.sync(workspaces, r.cx); await r.drain();
  assert.deepEqual(r.hcCalls.map(call => call.slice(0, 2)), [["send", "agent-1"], ["send", "agent-2"], ["send", "other"]]);
  assert.equal(r.hcCalls[0][2], workspaceMessage(workspaces.s1.folders));
  assert.match(r.hcCalls[0][2], /look in every listed root for applicable harness or instruction files/);
  assert.equal(r.hcCalls[2][2], workspaceMessage(workspaces.s2.folders));

  addAgent("agent-3");
  context.sync(workspaces, r.cx); await r.drain();
  assert.deepEqual(r.hcCalls.slice(3).map(call => call[1]), ["agent-3"]);
  workspaces = mapping({ s1: [roots.web, roots.api, roots.docs], s2: [roots.other] });
  context.sync(workspaces, r.cx); await r.drain();
  assert.deepEqual(r.hcCalls.slice(4).map(call => call[1]), ["agent-1", "agent-2", "agent-3"]);
  for (const call of r.hcCalls.slice(4)) assert.equal(call[2], workspaceMessage(workspaces.s1.folders));
  workspaces = mapping({ s1: [roots.web, roots.docs], s2: [roots.other] });
  context.sync(workspaces, r.cx); await r.drain();
  assert.deepEqual(r.hcCalls.slice(7).map(call => call[1]), ["agent-1", "agent-2", "agent-3"]);
  for (const call of r.hcCalls.slice(7)) assert.equal(call[2], workspaceMessage(workspaces.s1.folders));
  context.sync(workspaces, r.cx); await r.drain();
  assert.equal(r.hcCalls.length, 10);
});

test("failed sends expose the reason and retry once after blocked becomes idle", async t => {
  const { r, roots, addAgent, mapping } = await fixture(t);
  const { AgentWorkspaceContext } = await r.load("agent-context.js");
  const agent = addAgent("agent-1"), workspaces = mapping({ s1: [roots.web, roots.api] });
  const context = new AgentWorkspaceContext(); t.after(() => context.close());
  r.hooks.hc = () => r.hcCalls.length === 1 ? { code: 1, stdout: "", stderr: "terminal is unavailable" } : ok;
  context.sync(workspaces, r.cx); await r.drain();
  assert.equal(r.hcCalls.length, 1);
  assert.match(JSON.stringify(r.calls.filter(call => call.command === "notify")), /terminal is unavailable/);
  context.sync(workspaces, r.cx); context.sync(workspaces, r.cx); await r.drain();
  assert.equal(r.hcCalls.length, 1);
  agent.status = "blocked";
  r.terminals.find(terminal => terminal.address === agent.address).status = "blocked";
  context.sync(workspaces, r.cx); context.sync(workspaces, r.cx); await r.drain();
  assert.equal(r.hcCalls.length, 1);
  agent.status = "idle";
  r.terminals.find(terminal => terminal.address === agent.address).status = "idle";
  context.sync(workspaces, r.cx); await r.drain();
  assert.equal(r.hcCalls.length, 2);
  assert.equal(r.hcCalls[1][2], r.hcCalls[0][2]);
  context.sync(workspaces, r.cx); await r.drain();
  assert.equal(r.hcCalls.length, 2);
});

test("separate panel module copies share delivery ownership across close and reload", async t => {
  const { r, roots, addAgent, mapping } = await fixture(t);
  const { workspaceMessage } = await r.load("agent-context.js");
  addAgent("agent-1"); addAgent("agent-2");
  let workspaces = mapping({ s1: [roots.web, roots.api] });
  const { default: Files1 } = await r.load("main.js");
  const { default: Files2 } = await r.registry()("main.js");
  const first = new Files1(), second = new Files2();
  first.init({}, r.cx); second.init({}, r.cx);
  let closed = false;
  t.after(() => { if (!closed) { first.close(); second.close(); } });
  await r.drain();
  first.render(r.cx); second.render(r.cx); await r.drain();
  assert.deepEqual(r.hcCalls.map(call => call[1]), ["agent-1", "agent-2"]);
  for (const call of r.hcCalls) assert.equal(call[2], workspaceMessage(workspaces.s1.folders));
  workspaces = mapping({ s1: [roots.web, roots.docs] });
  second.render(r.cx); first.render(r.cx); await r.drain();
  assert.deepEqual(r.hcCalls.slice(2).map(call => call[1]), ["agent-1", "agent-2"]);
  for (const call of r.hcCalls.slice(2)) assert.equal(call[2], workspaceMessage(workspaces.s1.folders));
  first.close(); second.close(); closed = true;
  const { default: Reloaded } = await r.registry()("main.js");
  const reloaded = new Reloaded(); reloaded.init({}, r.cx); t.after(() => reloaded.close());
  await r.drain(); reloaded.render(r.cx); await r.drain();
  assert.equal(r.hcCalls.length, 4);
});

test("queued sends cannot dispatch after their owner closes or workspace is removed", async t => {
  const { r, roots, addAgent, mapping } = await fixture(t);
  const { AgentWorkspaceContext } = await r.load("agent-context.js");
  addAgent("agent-1");
  let workspaces = mapping({ s1: [roots.web, roots.api] });
  const closed = new AgentWorkspaceContext();
  closed.sync(workspaces, r.cx); closed.close(); await r.drain();
  assert.equal(r.hcCalls.length, 0);
  const removed = new AgentWorkspaceContext(); t.after(() => removed.close());
  removed.sync(workspaces, r.cx);
  workspaces = mapping({});
  removed.sync(workspaces, r.cx); await r.drain();
  assert.equal(r.hcCalls.length, 0);
  const departed = new AgentWorkspaceContext(); t.after(() => departed.close());
  workspaces = mapping({ s1: [roots.web, roots.api] });
  departed.sync(workspaces, r.cx);
  r.agents = [];
  departed.sync(workspaces, r.cx); await r.drain();
  assert.equal(r.hcCalls.length, 0);
});

test("closing an owner with an in-flight send cancels its queued replacement", async t => {
  const { r, roots, addAgent, mapping } = await fixture(t);
  const { AgentWorkspaceContext } = await r.load("agent-context.js");
  addAgent("agent-1");
  const reply = deferred();
  r.hooks.hc = () => reply.promise;
  const context = new AgentWorkspaceContext();
  let workspaces = mapping({ s1: [roots.web, roots.api] });
  context.sync(workspaces, r.cx); await nextTurn();
  assert.equal(r.hcCalls.length, 1);
  workspaces = mapping({ s1: [roots.web, roots.docs] });
  context.sync(workspaces, r.cx);
  context.close();
  reply.resolve(ok); await r.drain();
  assert.equal(r.hcCalls.length, 1);
});

test("deferred sends serialize rapid changes and acknowledge only the composition actually sent", async t => {
  const { r, roots, addAgent, mapping } = await fixture(t);
  const { AgentWorkspaceContext, workspaceMessage } = await r.load("agent-context.js");
  addAgent("agent-1");
  const firstReply = deferred(), latestReply = deferred();
  r.hooks.hc = () => r.hcCalls.length === 1 ? firstReply.promise : latestReply.promise;
  const context = new AgentWorkspaceContext();
  const { AgentWorkspaceContext: OtherContext } = await r.registry()("agent-context.js");
  const other = new OtherContext();
  t.after(() => { context.close(); other.close(); });
  let workspaces = mapping({ s1: [roots.web, roots.api] });
  const firstMessage = workspaceMessage(workspaces.s1.folders);
  context.sync(workspaces, r.cx); other.sync(workspaces, r.cx); await nextTurn();
  assert.equal(r.hcCalls.length, 1);
  assert.equal(r.hcCalls[0][2], firstMessage);
  workspaces = mapping({ s1: [roots.web, roots.docs] });
  context.sync(workspaces, r.cx); other.sync(workspaces, r.cx);
  workspaces = mapping({ s1: [roots.api, roots.docs] });
  other.sync(workspaces, r.cx); context.sync(workspaces, r.cx); await nextTurn();
  assert.equal(r.hcCalls.length, 1);
  firstReply.resolve(ok); await nextTurn();
  assert.equal(r.hcCalls.length, 2);
  assert.equal(r.hcCalls[1][2], workspaceMessage(workspaces.s1.folders));
  context.sync(workspaces, r.cx); await nextTurn();
  assert.equal(r.hcCalls.length, 2);
  latestReply.resolve(ok); await r.drain();
  context.sync(workspaces, r.cx); await r.drain();
  assert.equal(r.hcCalls.length, 2);
});

test("panel focus and browsing changes do not broadcast workspace updates", async t => {
  const { r, roots, addAgent, mapping } = await fixture(t);
  addAgent("agent-1"); addAgent("other", "s2");
  mapping({ s1: [roots.web, roots.api], s2: [roots.other] });
  const { default: Files } = await r.load("main.js");
  const panel = new Files(); panel.init({}, r.cx); t.after(() => panel.close());
  await r.drain(); panel.render(r.cx); await r.drain();
  assert.deepEqual(r.hcCalls.map(call => call[1]), ["agent-1", "other"]);
  r.focus.cwd = roots.api; r.panes[0].cwd = roots.api;
  panel.render(r.cx); await r.drain();
  r.picked = roots.docs;
  panel.changeFolder(r.cx); await r.drain();
  panel.render(r.cx); await r.drain();
  panel.useDefaultFolder(r.cx); panel.render(r.cx); await r.drain();
  r.spaces[0].active = false; r.spaces[1].active = true;
  r.focus = { space: "s2", tab: "tab2", pane: "p2", terminal: "other", cwd: roots.other };
  panel.render(r.cx); await r.drain();
  assert.equal(r.hcCalls.length, 2);
});
