import { agents, hc, notify } from "herdr";

export function workspaceMessage(folders) {
  return [
    "Files Plus workspace update:",
    "This session is in a multi-root workspace. Its current root directories are:",
    ...folders.map(folder => `- ${folder.path}`),
    "Before starting work, look in every listed root for applicable harness or instruction files. Do not assume the terminal's current directory is the only workspace root."
  ].join("\n");
}

export class AgentWorkspaceContext {
  sync(workspaces, cx) {
    const active = new Map(agents().map(agent => [agent.address, agent]));
    for (const [address, update] of this.updates || []) {
      if (!active.has(address) || !workspaces?.[update.space]?.folders?.length) this.updates.delete(address);
    }
    for (const agent of active.values()) {
      const folders = workspaces?.[agent.space]?.folders;
      if (!folders?.length) continue;
      const signature = JSON.stringify(folders.map(folder => folder.path));
      let update = this.updates.get(agent.address);
      if (!update) {
        update = { space: agent.space, delivered: null, failed: null, sending: false };
        this.updates.set(agent.address, update);
      }
      if (update.signature !== signature) {
        update.space = agent.space;
        update.signature = signature;
        update.message = workspaceMessage(folders);
        update.failed = null;
      }
      this.deliver(agent.address, cx);
    }
  }
  deliver(address, cx) {
    const update = this.updates?.get(address);
    if (!update || update.sending || update.delivered === update.signature || update.failed === update.signature) return;
    const signature = update.signature, message = update.message;
    update.sending = true;
    cx.spawn(async cx => {
      try {
        const result = await hc(["send", address, message]);
        if (result.code !== 0) throw new Error(result.stderr?.trim() || result.stdout?.trim() || "hc send failed");
        update.delivered = signature;
      } catch (error) {
        if (update.signature === signature) {
          update.failed = signature;
          notify({ title: `Could not update agent ${address} with workspace roots`, level: "error" });
        }
      } finally {
        update.sending = false;
        if (this.updates?.get(address) === update && update.delivered !== update.signature && update.failed !== update.signature) this.deliver(address, cx);
      }
    });
  }
  close() { this.updates?.clear(); }
  updates = new Map();
}
