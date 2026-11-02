import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { settings } from "herdr";

export const TITLES = { "new-file": "New file", "new-folder": "New folder", rename: "Rename", trash: "Move to Trash", "add-root": "Add folder to workspace", "remove-root": "Remove from workspace" };
const defaults = { unit13: 7.6, unit12: 7 }, samples = ["MMMMMMMMMM", "中文文件目录名称示例"];
let calibrated = { ...defaults }, calibrationKey;
export const zoom = () => settings().zoom || 1;
export const viewport = () => globalThis.window?.viewport_size?.() || null;
export function textUnits(text) {
  let width = 0;
  for (const char of String(text || "")) {
    const cp = char.codePointAt(0);
    if (/[\u0300-\u036f\ufe00-\ufe0f\u200d]/.test(char)) continue;
    width += cp >= 0x1100 && (cp <= 0x115f || cp >= 0x2e80 && cp <= 0xa4cf || cp >= 0xac00 && cp <= 0xd7af || cp >= 0xf900 && cp <= 0xfaff || cp >= 0xfe10 && cp <= 0xfe6f || cp >= 0xff01 && cp <= 0xff60 || cp >= 0x1f000) ? 2 : 1;
  }
  return width;
}
export const textWidth = (text, size = 13, metrics = calibrated) => textUnits(text) * metrics[`unit${size}`];
export function metrics() {
  const s = settings(), key = JSON.stringify([s.font_family, s.ui_font_size, s.zoom]);
  if (key !== calibrationKey) { calibrationKey = key; calibrated = { ...defaults }; }
  return calibrated;
}
export function calibrationProbe(onChange) {
  metrics();
  const key = calibrationKey;
  // A zero-opacity subtree is not painted by Herdr 0.1.11, including size callbacks.
  // Place this faint probe behind the opaque header, outside normal layout flow.
  return v_flex().id(`files-metrics-${key}`).absolute().left(0).top(0).opacity(0.01).w(400).h(32).flex_none().children([12, 13].map(size => h_flex().flex_none().children(samples.map((sample, index) =>
    div().id(`metrics-${size}-${index}`).flex_none().whitespace_nowrap().text_size(size).child(sample).on_size_change((box, cx) => {
      if (key !== calibrationKey || box.width <= 0) return;
      const unit = box.width / zoom() / textUnits(sample), property = `unit${size}`;
      const values = calibrated[`samples${size}`] || [];
      if (Math.abs((values[index] || 0) - unit) < 0.05) return;
      values[index] = unit;
      calibrated = { ...calibrated, [`samples${size}`]: values, [property]: Math.max(...values.filter(Boolean)) };
      onChange(cx);
    })))));
}
export function dialogLayout(action, target, values = metrics(), view = viewport(), scale = zoom()) {
  const prompt = action === "trash" ? `Permanently delete “${target.path.split("/").pop()}”? This cannot be undone.` : action === "remove-root" ? "Remove this folder from the workspace? Files on disk are kept." : "";
  const width = Math.min(Math.max(420, Math.min(560, Math.ceil(Math.max(textWidth(TITLES[action], 13, values), textWidth(target.path, 12, values), textWidth(prompt, 13, values)) + 40))), view ? Math.max(188, view.width / scale - 32) : 560);
  return { width, height: action === "add-root" ? 220 : action === "remove-root" || action === "trash" ? 252 : 240 };
}
