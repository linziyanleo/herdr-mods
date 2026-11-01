import { settings } from "herdr";

// Radix Gray: backgrounds 1–3, hover 4, selection 5, border 6, text 11–12.
const light = ["#fcfcfc", "#f9f9f9", "#f0f0f0", "#e8e8e8", "#e0e0e0", "#d9d9d9", "#646464", "#202020"];
const dark = ["#111111", "#191919", "#222222", "#2a2a2a", "#313131", "#3a3a3a", "#b4b4b4", "#eeeeee"];
export function palette() {
  const night = settings().dark !== false, g = night ? dark : light;
  return { background: g[0], surface: g[1], raised: g[2], hover: g[3], selected: g[4], border: g[5], muted: g[6], foreground: g[7],
    blue: night ? "#70b8ff" : "#0d74ce", green: night ? "#3dd68c" : "#218358", red: night ? "#ff9592" : "#ce2c31", amber: night ? "#ffca16" : "#ab6400", purple: night ? "#d19dff" : "#8145b5" };
}
