import { absolute, kind, normalize } from "./paths.js";

// Configuration belongs to the receiving Preview Plus, never to an incoming file target.
export function syncRoots(value) {
  return Array.isArray(value) ? [...new Set(value
    .filter(root => typeof root === "string" && absolute(root) && !root.includes("\0"))
    .map(normalize))] : [];
}

export function localCopyPath(target, roots = []) {
  if (!target?.on || !["image", "pdf"].includes(kind(target.file))) return null;
  const file = normalize(target.file);
  if (file.includes("\0")) return null;
  return roots.some(root => file.startsWith(root.endsWith("/") ? root : root + "/") && file !== root) ? file : null;
}
