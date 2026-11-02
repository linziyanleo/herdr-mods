import { settings } from "herdr";

// Radix Gray steps 1–12; backgrounds 1–5, borders 6–8, text 11–12.
const light = ["#fcfcfc", "#f9f9f9", "#f0f0f0", "#e8e8e8", "#e0e0e0", "#d9d9d9", "#cecece", "#bbbbbb", "#8d8d8d", "#838383", "#646464", "#202020"];
const dark = ["#111111", "#191919", "#222222", "#2a2a2a", "#313131", "#3a3a3a", "#484848", "#606060", "#6e6e6e", "#7b7b7b", "#b4b4b4", "#eeeeee"];
export function palette() {
  const night = settings().dark !== false, g = night ? dark : light;
  return { background: g[0], popover: g[1], raised: g[2], hover: g[2], selected: g[3], border: g[5], input: g[6], focus: g[7], muted: g[10], foreground: g[11], solid: g[11], solidText: g[0],
    red: night ? "#ff9592" : "#ce2c31", green: night ? "#3dd68c" : "#218358", amber: night ? "#ffca16" : "#ab6400", blue: night ? "#70b8ff" : "#0d74ce", purple: night ? "#d19dff" : "#8145b5" };
}
