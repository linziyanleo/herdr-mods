// Parse top-level headings and fences once, using offsets into untouched source.
// Fence state applies to every language, so nested examples never become diagrams.
const titleText = value => value.replace(/!?(\[([^\]]*)\])\([^)]*\)/g, "$2")
  .replace(/<[^>]*>/g, "").replace(/(^|\s)__?([^_]+)__?(?=\s|$)/g, "$1$2")
  .replace(/[`*~]/g, "").replace(/\\([\p{P}\p{S}])/gu, "$1")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').trim();

export function markdownStructure(text) {
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) || [], headings = [], diagrams = [], used = new Set(), counts = new Map();
  let offset = 0, fence = null, previous = null;
  const heading = (raw, level, start) => {
    const title = titleText(raw), base = title.toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "").replace(/\s/g, "-") || "section";
    let suffix = counts.get(base) || 0, slug = suffix ? `${base}-${suffix}` : base;
    while (used.has(slug)) slug = `${base}-${++suffix}`;
    counts.set(base, suffix + 1);
    used.add(slug); headings.push({ title: title || "Untitled", level, slug, start });
  };
  for (const line of lines) {
    const value = line.replace(/\r?\n$/, ""), marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(value);
    if (fence) {
      if (marker && marker[1][0] === fence.marker[0] && marker[1].length >= fence.marker.length && !marker[2].trim()) {
        if (fence.mermaid) diagrams.push({ start: fence.start, end: offset + line.length, source: text.slice(fence.body, offset), closed: true });
        fence = null;
      }
      previous = null;
    } else if (marker && !(marker[1][0] === "`" && marker[2].includes("`"))) {
      fence = { marker: marker[1], start: offset, body: offset + line.length, mermaid: marker[2].trim().toLowerCase() === "mermaid" };
      previous = null;
    } else {
      const atx = /^ {0,3}(#{1,6})(?:[ \t]+(.*?)|[ \t]*)$/.exec(value);
      if (atx) { heading((atx[2] || "").replace(/[ \t]+#+[ \t]*$/, ""), atx[1].length, offset); previous = null; }
      else if (previous && /^ {0,3}(?:=+|-+)[ \t]*$/.test(value)) {
        heading(previous.text, value.trim()[0] === "=" ? 1 : 2, previous.start); previous = null;
      } else previous = value.trim() && !/^(?: {4}|\t| {0,3}(?:>|[-+*] |\d+[.)] |\[.*\]:))/.test(value) ? { text: value, start: offset } : null;
    }
    offset += line.length;
  }
  if (fence?.mermaid) diagrams.push({ start: fence.start, end: text.length, source: text.slice(fence.body), closed: false });
  return { headings, diagrams };
}
