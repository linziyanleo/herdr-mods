import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { runtime } from "./runtime.mjs";

test("workspace roots reach existing and new agents, then rebroadcast after root changes", async t => {
  const r = await runtime(t), { AgentWorkspaceContext } = await r.load("agent-context.js");
  const web = path.join(r.dir, "web"), api = path.join(r.dir, "api"), docs = path.join(r.dir, "docs");
  r.agents = [{ address: "t-agent-1", space: "s1" }, { address: "t-agent-2", space: "s1" }, { address: "t-other", space: "s2" }];
  const context = new AgentWorkspaceContext(), workspaces = { s1: { folders: [{ path: web }, { path: api }] } };

  context.sync(workspaces, r.cx); await r.drain();
  assert.deepEqual(r.hcCalls.map(([command, address]) => [command, address]), [["send", "t-agent-1"], ["send", "t-agent-2"]]);
  assert.match(r.hcCalls[0][2], new RegExp(`- ${web}`));
  assert.match(r.hcCalls[0][2], new RegExp(`- ${api}`));
  assert.match(r.hcCalls[0][2], /look in every listed root for applicable harness or instruction files/);

  r.agents.push({ address: "t-agent-3", space: "s1" });
  context.sync(workspaces, r.cx); await r.drain();
  assert.deepEqual(r.hcCalls.slice(2).map(([, address]) => address), ["t-agent-3"]);

  workspaces.s1.folders = [{ path: web }, { path: docs }];
  context.sync(workspaces, r.cx); await r.drain();
  assert.deepEqual(r.hcCalls.slice(3).map(([, address]) => address), ["t-agent-1", "t-agent-2", "t-agent-3"]);
  assert.match(r.hcCalls.at(-1)[2], new RegExp(`- ${docs}`));
  assert.doesNotMatch(r.hcCalls.at(-1)[2], new RegExp(`- ${api}`));
});
