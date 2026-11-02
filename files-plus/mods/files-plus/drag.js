import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { props, openOverlay, closeOverlay } from "herdr";
import { basename } from "./roots.js";
import { insertReference } from "./actions.js";
import { metrics, textWidth, viewport, zoom } from "./metrics.js";
import { appearance, textStyle } from "./appearance.js";

export const inBounds = (point, bounds) => Boolean(point && bounds && point.x >= bounds.x && point.x <= bounds.x + bounds.width && point.y >= bounds.y && point.y <= bounds.y + bounds.height);
export function dragMove(panel, event, cx) {
  const candidate = panel.dragCandidate, view = viewport();
  if (!candidate || !view || !panel.panelBounds) return;
  if (Math.hypot(event.position.x - candidate.start.x, event.position.y - candidate.start.y) < 6 * zoom()) return;
  panel.dragCandidate = null; panel.suppressClick = true;
  openOverlay({ mod: "files-plus", kind: "window", frame: "none", width: Math.ceil(view.width / zoom()), height: Math.ceil(view.height / zoom()), at: { x: 0, y: 0 },
    props: { role: "drag", target: candidate.target, panelBounds: panel.panelBounds, cursor: event.position } });
  cx.stop_propagation();
}
export function dropDrag(view, cx) {
  if (view.busy) return;
  if (inBounds(view.cursor, props().panelBounds) || !view.targetEntry.active?.terminal) { closeOverlay(props().overlay); return; }
  view.busy = true; cx.notify();
  cx.spawn(async cx => {
    try { await insertReference(view.targetEntry, cx); closeOverlay(props().overlay); }
    catch (error) { view.busy = false; view.error = error.message || String(error); cx.notify(); }
  });
}
export function renderDrag(view, cx) {
  const p = props(), { colors: t, typography: type, spacing: s, radius: r } = appearance(cx), scale = zoom(), screen = viewport() || { width: 1000, height: 800 };
  const outside = !inBounds(view.cursor, p.panelBounds), canDrop = outside && Boolean(view.targetEntry.active?.terminal);
  const name = view.error || basename(view.targetEntry.path), hint = canDrop ? "Click to add @" : "@";
  const height = type.md.line_height + s.sm;
  const width = Math.min(screen.width / scale - 2 * s.sm, Math.max(100, textWidth(name, 13, metrics(cx)) + textWidth(hint, 12, metrics(cx)) + 4 * s.sm + type.sm.size));
  const x = Math.max(s.sm, Math.min(view.cursor.x / scale + s.md, screen.width / scale - width - s.sm));
  const y = Math.max(s.sm, Math.min(view.cursor.y / scale + s.md, screen.height / scale - height - s.sm));
  return div().id("files-drag").size_full().relative().track_focus(view.handle)
    .when(canDrop, el => el.cursor_copy()).when(outside && !canDrop, el => el.cursor_no_drop()).when(!outside, el => el.cursor_grabbing())
    .on_mouse_move((event, cx) => { view.cursor = event.position; cx.notify(); })
    .on_mouse_down("left", (_event, cx) => cx.stop_propagation())
    .on_mouse_up("left", (event, cx) => { view.cursor = event.position; cx.stop_propagation(); dropDrag(view, cx); })
    .on_click((event, cx) => { view.cursor = event.position; cx.stop_propagation(); dropDrag(view, cx); })
    .on_mouse_down("right", (_event, cx) => { if (!view.busy) closeOverlay(p.overlay); cx.stop_propagation(); })
    .on_key_down((event, cx) => { if (event.key === "escape" && !view.busy) { closeOverlay(p.overlay); cx.stop_propagation(); } })
    .child(textStyle(h_flex().id("files-drag-pill").absolute().left(x).top(y).w(width).h(height).px(s.sm).gap(s.sm).items_center().rounded(r.md).bg(t.popover).text_color(view.error ? t.ansi1 : t.foreground), type.md, type.sans)
      .child(svg(`mods/files-plus/${view.targetEntry.kind === "file" ? "file" : "folder"}.svg`).size(type.sm.size).flex_none().text_color(t.muted))
      .child(div().flex_1().min_w(0).truncate().child(name)).child(textStyle(div().text_color(t.muted), type.sm, type.sans).child(hint)));
}
