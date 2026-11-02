import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { props, openOverlay, closeOverlay } from "herdr";
import { basename } from "./roots.js";
import { insertReference } from "./actions.js";
import { metrics, textWidth, viewport, zoom } from "./metrics.js";
import { palette } from "./palette.js";

export const inBounds = (point, bounds) => Boolean(point && bounds && point.x >= bounds.x && point.x <= bounds.x + bounds.width && point.y >= bounds.y && point.y <= bounds.y + bounds.height);
export function dragMove(panel, event, cx) {
  const candidate = panel.dragCandidate, view = viewport();
  if (!candidate || !view || !panel.panelBounds) return;
  if (Math.hypot(event.position.x - candidate.start.x, event.position.y - candidate.start.y) < 6 * zoom()) return;
  panel.dragCandidate = null; panel.suppressClick = true;
  openOverlay({ mod: "files-plus", kind: "popup", frame: "none", width: Math.ceil(view.width / zoom()), height: Math.ceil(view.height / zoom()), at: { x: 0, y: 0 },
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
export function renderDrag(view) {
  const p = props(), t = palette(), scale = zoom(), screen = viewport() || { width: 1000, height: 800 };
  const outside = !inBounds(view.cursor, p.panelBounds), canDrop = outside && Boolean(view.targetEntry.active?.terminal);
  const name = view.error || basename(view.targetEntry.path), width = Math.min(screen.width / scale - 16, Math.max(100, textWidth(name, 13, metrics()) + 70));
  const x = Math.max(8, Math.min(view.cursor.x / scale + 12, screen.width / scale - width - 8));
  const y = Math.max(8, Math.min(view.cursor.y / scale + 10, screen.height / scale - 42));
  return div().id("files-drag").size_full().relative().track_focus(view.handle)
    .when(canDrop, el => el.cursor_copy()).when(outside && !canDrop, el => el.cursor_no_drop()).when(!outside, el => el.cursor_grabbing())
    .on_mouse_move((event, cx) => { view.cursor = event.position; cx.notify(); })
    .on_mouse_up("left", (event, cx) => { view.cursor = event.position; cx.stop_propagation(); dropDrag(view, cx); })
    .on_mouse_down("right", (_event, cx) => { if (!view.busy) closeOverlay(p.overlay); cx.stop_propagation(); })
    .on_key_down((event, cx) => { if (event.key === "escape" && !view.busy) { closeOverlay(p.overlay); cx.stop_propagation(); } })
    .child(h_flex().id("files-drag-pill").absolute().left(x).top(y).w(width).h(32).px(8).gap(8).items_center().rounded(6).bg(t.popover).border(0.5).border_color(view.error ? t.red : canDrop ? t.blue : t.border).text_color(t.foreground).text_size(13)
      .opacity(view.entered ? 1 : 0).transition("opacity", { duration: 250, easing: "ease-out" })
      .child(svg(`mods/files-plus/${view.targetEntry.kind === "file" ? "file" : "folder"}.svg`).size(14).flex_none().text_color(t.muted))
      .child(div().flex_1().min_w(0).truncate().child(name)).child(div().text_color(t.muted).child("@")));
}
