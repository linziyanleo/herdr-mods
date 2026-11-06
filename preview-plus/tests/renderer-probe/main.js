// An eager check in the actual QuickJS runtime; no hc or window session needed.
import { View, div } from "gpui-kit";
import { renderMermaidSVG } from "./mermaid.bundle.js";

export default class RendererProbe extends View {
  init() {
    const samples = [
      "flowchart LR\nA[Read] --> B[Preview]",
      "sequenceDiagram\nAlice->>Bob: Hello",
      "stateDiagram-v2\n[*] --> Ready\nReady --> Done",
      "classDiagram\nclass Document {\n+save()\n}\nDocument --> Draft",
      "erDiagram\nUSER ||--o{ FILE : owns",
    ];
    for (const source of samples) {
      const svg = renderMermaidSVG(source);
      if (!svg.startsWith("<svg") || !svg.includes("</svg>")) throw new Error("Invalid Mermaid output: " + source);
    }
  }
  render() { return div().child("Five Mermaid diagram types rendered in QuickJS."); }
}
