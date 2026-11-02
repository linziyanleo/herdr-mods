import { textWidth } from "./metrics.js";

export function findNode(tree, id) {
  if (!tree || typeof tree !== "object") return null;
  if (tree.id === id) return tree;
  for (const node of tree.children || []) { const found = findNode(node, id); if (found) return found; }
  return null;
}
export function panelWidth(rows, title, metrics, look) {
  const { spacing: s, typography: type } = look;
  const header = 2 * s.md + textWidth("Files", 13, metrics) + type.md.line_height + 3 * s.sm + textWidth(title, 12, metrics);
  // Expanded descendants must not move the divider beside the workspace.
  const widths = rows.filter(row => !row.depth).map(row => {
    const padding = 2 * s.sm;
    if (row.kind === "status") return padding + textWidth(row.name, 12, metrics);
    return padding + type.xs.size + type.sm.size + 2 * s.sm + textWidth(row.name, 13, metrics)
      + (row.detail ? s.sm + textWidth(row.detail, 12, metrics) : 0) + (row.mark ? s.sm + textWidth(row.mark, 12, metrics) : 0);
  });
  return Math.ceil(Math.max(header, ...widths) + 2 * s.md);
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
