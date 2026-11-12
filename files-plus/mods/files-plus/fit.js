import { textWidth } from "./metrics.js";

export function findNode(tree, id) {
  if (!tree || typeof tree !== "object") return null;
  if (tree.id === id) return tree;
  for (const node of tree.children || []) { const found = findNode(node, id); if (found) return found; }
  return null;
}
export function panelWidth(rows, title, metrics, controls = 2) {
  const header = 28 + textWidth(title, 13, metrics) + Math.max(0, controls) * (24 + 8);
  // Expanded descendants must not move the divider beside the workspace.
  const widths = rows.filter(row => !row.depth).map(row => {
    const padding = 16;
    if (row.kind === "status") return padding + textWidth(row.name, 12, metrics);
    return padding + 12 + 14 + 14 + textWidth(row.name, 13, metrics)
      + (row.detail ? 7 + textWidth(row.detail, 12, metrics) : 0) + (row.mark ? 7 + textWidth(row.mark, 12, metrics) : 0);
  });
  return Math.ceil(Math.max(header, ...widths) + 26);
}
export function fittedWidth(intrinsic, fit, tree, view, zoom = 1) {
  const node = findNode(tree, fit.node), sidebar = findNode(tree, "sidebar");
  const min = Math.max(node?.min ?? 280, fit.min ?? 280), vw = view ? view.width / zoom : null;
  const max = fit.max > 0 ? fit.max : 0.38;
  const rawMax = max <= 1 ? vw ? Math.floor(vw * max) : 560 : max;
  const sidebarPx = sidebar?.hidden ? 0 : sidebar?.size?.px || 0;
  const effectiveMax = Math.max(min, Math.min(rawMax, node?.max ?? 900, vw ? Math.max(min, vw - sidebarPx - 360) : rawMax));
  return Math.round(Math.max(min, Math.min(intrinsic, effectiveMax)));
}
export function shouldFit(desired, current, cause) {
  return cause === "user" ? Math.abs(desired - current) >= 16 : desired > current + 16;
}
