import { settings, theme } from "herdr";

export function palette() {
  const t = theme();
  return { ...t, focus: t.accent, solidText: t.solid_foreground, red: t.ansi1, green: t.ansi2, amber: t.ansi3, blue: t.ansi4, purple: t.ansi5 };
}
export function typography() {
  const s = settings(), body = Math.max(12, s.ui_font_size ?? 13);
  return { font: s.ui_font_family, body, secondary: Math.max(12, body - 1), heading: body + 1 };
}
export function sourceStyle() {
  const s = settings(), t = theme();
  return { font_family: s.font_family, font_size: s.font_size,
    syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 } };
}
