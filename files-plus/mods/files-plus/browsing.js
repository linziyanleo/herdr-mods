import { shared, setShared, spaces } from "herdr";

export const BROWSING = "files-plus.browsing";
export function browsingFolder(space, on) {
  const saved = shared(BROWSING)?.[space];
  return saved && saved.on === on && typeof saved.path === "string" ? saved.path : null;
}
export function setBrowsingFolder(space, on, path) {
  if (!spaces().some(s => s.id === space && (s.machine ?? null) === on)) return false;
  const next = { ...(shared(BROWSING) || {}) };
  if (path) next[space] = { path, on }; else delete next[space];
  setShared(BROWSING, next);
  return true;
}
