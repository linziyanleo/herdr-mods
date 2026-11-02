import { settings, theme } from "herdr";

// Only values exposed by Herdr belong here. Control defaults match its shipped mods.
export function appearance() {
  return { colors: theme(), font: settings().ui_font_family };
}

export function sourceStyle() {
  const s = settings(), t = theme();
  return { font_family: s.font_family, font_size: s.font_size / (s.zoom || 1),
    syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 } };
}
