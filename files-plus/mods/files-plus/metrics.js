import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { settings } from "herdr";
import { appearance, textStyle } from "./appearance.js";

export const TITLES = { "new-file": "New file", "new-folder": "New folder", rename: "Rename", trash: "Move to Trash", "add-root": "Add folder to workspace", "remove-root": "Remove from workspace" };
const samples = ["MMMMMMMMMM", "中文文件目录名称示例"];
let calibrated, calibrationKey;
export const zoom = () => settings().zoom || 1;
export const viewport = () => globalThis.window?.viewport_size?.() || null;
export function textUnits(text) {
  let width = 0;
  for (const char of String(text || "")) {
    const cp = char.codePointAt(0);
    if (/[\u0300-\u036f\ufe00-\ufe0f\u200d]/.test(char)) continue;
    width += cp >= 0x1100 && (cp <= 0x115f || cp >= 0x2300 && cp <= 0x23ff || cp >= 0x2600 && cp <= 0x27bf || cp >= 0x2e80 && cp <= 0xa4cf || cp >= 0xac00 && cp <= 0xd7af || cp >= 0xf900 && cp <= 0xfaff || cp >= 0xfe10 && cp <= 0xfe6f || cp >= 0xff01 && cp <= 0xff60 || cp >= 0x1f000) ? 2 : 1;
  }
  return width;
}
export const textWidth = (text, size = 13, metrics = calibrated) => textUnits(text) * metrics[`unit${size}`];
export function metrics(cx) {
  const type = appearance(cx).typography, key = JSON.stringify([type.sans, type.md, type.sm, zoom()]);
  if (key !== calibrationKey) { calibrationKey = key; calibrated = { unit13: type.md.size * 0.6, unit12: type.sm.size * 0.6 }; }
  return calibrated;
}
export function calibrationProbe(cx, onChange) {
  metrics(cx);
  const key = calibrationKey, { typography: type, spacing } = appearance(cx);
  // A zero-opacity subtree is not painted by Herdr 0.1.11, including size callbacks.
  // Place this faint probe behind the opaque header, outside normal layout flow.
  return v_flex().id(`files-metrics-${key}`).absolute().left(0).top(0).opacity(0.01).w(400).h(type.md.line_height + spacing.sm).flex_none().font_family(type.sans).children([12, 13].map(size => h_flex().flex_none().children(samples.map((sample, index) =>
    textStyle(div().id(`metrics-${size}-${index}`).flex_none().whitespace_nowrap(), size === 13 ? type.md : type.sm, type.sans).child(sample).on_size_change((box, cx) => {
      if (key !== calibrationKey || box.width <= 0) return;
      const unit = box.width / zoom() / textUnits(sample), property = `unit${size}`;
      const values = calibrated[`samples${size}`] || [];
      if (Math.abs((values[index] || 0) - unit) < 0.05) return;
      values[index] = unit;
      calibrated = { ...calibrated, [`samples${size}`]: values, [property]: Math.max(...values.filter(Boolean)) };
      onChange(cx);
    })))));
}
export function dialogLayout(action, target, cx, view = viewport(), scale = zoom()) {
  const values = metrics(cx), { spacing: s, typography: type } = appearance(cx);
  const prompt = action === "trash" ? `Permanently delete “${target.path.split("/").pop()}”? This cannot be undone.` : action === "remove-root" ? "Remove this folder from the workspace? Files on disk are kept." : "";
  const width = Math.min(Math.max(420, Math.min(560, Math.ceil(Math.max(textWidth(TITLES[action], 13, values), textWidth(target.path, 12, values), textWidth(prompt, 13, values)) + 2 * s.lg))), view ? Math.max(188, view.width / scale - 2 * s.lg) : 560);
  const lines = action === "trash" || action === "remove-root" ? 8 : action === "add-root" ? 7 : 6;
  return { width, height: Math.max(240, lines * type.md.line_height + s.xxl + 2 * s.lg) };
}
