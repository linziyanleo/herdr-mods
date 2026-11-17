import { absolute, kind, normalize } from "./paths.js";

// Configuration belongs to the receiving Preview Plus, never to an incoming file target.
export function syncRoots(value) {
  return Array.isArray(value) ? [...new Set(value
    .filter(root => typeof root === "string" && absolute(root) && !root.includes("\0"))
    .map(normalize))] : [];
}

export function localCopyTarget(target, roots) {
  if (!target?.on || !["image", "pdf"].includes(kind(target.file))) return null;
  const file = normalize(target.file);
  const matches = syncRoots(roots).filter(root => file.startsWith(root.endsWith("/") ? root : root + "/"));
  return matches.length ? { ...target, file, on: null, localCopy: true, syncRoots: matches } : null;
}

export function mediaSource(target, roots) {
  if (!target.on) return target;
  const local = localCopyTarget(target, roots);
  if (!local) throw new Error("Image and PDF previews are only available for local files. To preview a local copy, explicitly configure localSyncRoots in Preview Plus.");
  return local;
}
