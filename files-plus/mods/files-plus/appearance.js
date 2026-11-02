import { settings, theme } from "herdr";

export function appearance(cx) {
  const native = cx.theme(), s = settings();
  // Herdr 0.1.11's Base projection drops color alpha and retains default font faces.
  return { ...native, colors: theme(), typography: { ...native.typography, sans: s.ui_font_family, mono: s.font_family } };
}

export function textStyle(el, token, font) {
  return el.font_family(font).text_size(token.size).line_height(`${token.line_height}px`).font_weight(token.weight);
}

export function sourceStyle() {
  const s = settings(), t = theme();
  return { font_family: s.font_family, font_size: s.font_size / (s.zoom || 1),
    syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 } };
}
