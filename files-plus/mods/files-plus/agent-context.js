import { agents, hc, notify, shared, setShared, spaces, terminals, window as appWindow } from "herdr";

export function workspaceMessage(folders) {
  return [
    "Files Plus workspace update:",
    "This session is in a multi-root workspace. Its current root directories are:",
    ...folders.map(folder => `- ${folder.path}`),
    "Before starting work, look in every listed root for applicable harness or instruction files. Do not assume the terminal's current directory is the only workspace root."
  ].join("\n");
}

// Claims are leases rather than permanent locks: a mod runtime can disappear on
// reload without running close(). A live sender renews only its own claim.
const KEY = "files-plus.agent-context", WORKSPACES = "multi-root.spaces";
const LEASE = 30000, RENEW = 10000;
const token = () => `${Date.now()}-${Math.random()}`;
const eligible = agent => agent.status !== "blocked";
const signature = folders => JSON.stringify(folders.map(folder => folder.path));
const sessionOf = (agent, terminal) => JSON.stringify([
  agent.address, agent.space, agent.app ?? null, terminal?.created_ms ?? null, terminal?.pid ?? null
]);

function records() { return shared(KEY) || {}; }
function save(address, record) {
  const all = { ...records() };
  if (record) all[address] = record; else delete all[address];
  setShared(KEY, all);
}

export class AgentWorkspaceContext {
  sync(workspaces, cx) {
    if (this.closed) return;
    this.workspaces = workspaces;
    this.sharedWorkspaces = shared(WORKSPACES) != null;
    const local = new Set(spaces().filter(space => space.machine === null).map(space => space.id));
    const supported = appWindow()?.platform !== "windows";
    const terminalMap = new Map(terminals().map(terminal => [terminal.address, terminal]));
    const active = new Set();
    for (const agent of agents()) {
      const folders = supported && local.has(agent.space) && workspaces?.[agent.space]?.folders;
      if (!folders?.length) continue;
      const terminal = terminalMap.get(agent.address);
      if (terminal && terminal.state !== "live") continue;
      const session = sessionOf(agent, terminal), roots = signature(folders);
      active.add(agent.address);
      let update = this.updates.get(agent.address);
      if (!update || update.session !== session || update.roots !== roots) {
        update = { session, roots, space: agent.space, message: workspaceMessage(folders) };
        this.updates.set(agent.address, update);
      }
      this.deliver(agent, update, cx);
    }
    for (const address of this.updates.keys()) if (!active.has(address)) this.updates.delete(address);
    // Keep an already-dispatched claim until it settles or expires, even if
    // its agent or workspace disappeared. Its old delivery is no longer valid.
    for (const [address, record] of Object.entries(records())) {
      if (active.has(address)) continue;
      if (record.claim?.dispatched && record.claim.expires > Date.now()) {
        if (record.delivered !== undefined || record.failed !== undefined) {
          const next = { ...record }; delete next.delivered; delete next.failed; save(address, next);
        }
      } else save(address, null);
    }
  }

  // Re-read live data immediately before dispatch and again before recording
  // success. The supplied mapping is a fallback for standalone callers only.
  current(address, update, afterClose = false) {
    if ((!afterClose && (this.closed || this.updates.get(address) !== update)) || appWindow()?.platform === "windows") return null;
    const agent = agents().find(item => item.address === address);
    if (!agent || agent.space !== update.space || !spaces().some(space => space.id === agent.space && space.machine === null)) return null;
    const terminal = terminals().find(item => item.address === address);
    if (terminal && terminal.state !== "live" || sessionOf(agent, terminal) !== update.session) return null;
    const mapping = this.sharedWorkspaces ? shared(WORKSPACES) : this.workspaces;
    const folders = mapping?.[agent.space]?.folders;
    return folders?.length && signature(folders) === update.roots ? agent : null;
  }

  wakeAt(expires, cx) {
    if (this.wake && this.wake <= expires) return;
    this.wake = expires;
    cx.timer.after(Math.max(0, expires - Date.now()) + 1, cx => {
      if (this.closed || this.wake !== expires) return;
      this.wake = null;
      cx.notify();
    });
  }

  deliver(agent, update, cx) {
    const address = agent.address, now = Date.now();
    let record = records()[address] || {};
    const claim = record.claim;
    if (claim && claim.expires > now) {
      this.wakeAt(claim.expires, cx);
      return;
    }
    if (claim) {
      record = { ...record }; delete record.claim;
      save(address, record);
    }
    const sameSession = record.session === update.session && record.space === update.space;
    if (sameSession && record.delivered === update.roots) return;
    if (sameSession && record.failed?.roots === update.roots) {
      if (record.failed.status === (agent.status ?? null)) return;
      record = { ...record }; delete record.failed;
      save(address, record);
    }
    if (!eligible(agent)) return;
    const id = token(), lease = { owner: this.owner, id, expires: now + LEASE, dispatched: false };
    record = sameSession ? { ...record, claim: lease } : { session: update.session, space: update.space, claim: lease };
    // Once a different composition is dispatched, an earlier success no
    // longer proves which composition the agent has most recently received.
    if (record.delivered !== update.roots) delete record.delivered;
    save(address, record);
    cx.spawn(async cx => {
      const owned = () => {
        const value = records()[address];
        return value?.claim?.owner === this.owner && value.claim.id === id && value.claim.expires > Date.now() ? value : null;
      };
      let value = owned(), live = this.current(address, update);
      if (!value || !live || !eligible(live)) {
        if (value) { value = { ...value }; delete value.claim; save(address, value); }
        return;
      }
      value = { ...value, claim: { ...value.claim, dispatched: true } };
      save(address, value);
      const renew = cx => {
        const value = owned();
        if (!value || this.closed) return;
        save(address, { ...value, claim: { ...value.claim, expires: Date.now() + LEASE } });
        cx.timer.after(RENEW, renew);
      };
      cx.timer.after(RENEW, renew);
      const attemptedStatus = live.status ?? null;
      try {
        const result = await hc(["send", address, update.message]);
        if (result.code !== 0) throw new Error(result.stderr?.trim() || result.stdout?.trim() || `hc send failed (exit ${result.code})`);
        value = owned();
        if (value && this.current(address, update, this.closed)) {
          value = { ...value, delivered: update.roots }; delete value.failed;
          save(address, value);
        }
      } catch (error) {
        value = owned();
        if (value && this.current(address, update)) {
          value = { ...value, failed: { roots: update.roots, status: attemptedStatus } };
          save(address, value);
          notify({ title: `Could not update agent ${address} with workspace roots`, body: String(error?.message || error), level: "error" });
        }
      } finally {
        value = owned();
        if (value) { value = { ...value }; delete value.claim; save(address, value); }
        if (!this.closed) {
          const next = this.updates.get(address), agent = next && this.current(address, next);
          if (agent) this.deliver(agent, next, cx);
        }
      }
    });
  }

  close() {
    this.closed = true;
    this.updates.clear();
    for (const [address, record] of Object.entries(records())) {
      if (record.claim?.owner !== this.owner || record.claim.dispatched) continue;
      const next = { ...record }; delete next.claim; save(address, next);
    }
  }
  owner = token();
  updates = new Map();
}
