export const FIND_LIMIT = 1000;

export function typedLocation(value) {
  const coordinate = /^(\d+)(?::(\d+))?$/.exec(value.trim());
  return coordinate ? { line: Number(coordinate[1]), column: Number(coordinate[2] ?? 1) } : null;
}

export function sourceRange(text, location, partial) {
  const { line, column = 1, expectedLine, match } = location || {};
  if (!Number.isSafeInteger(line) || line < 1 || !Number.isSafeInteger(column) || column < 1)
    return { error: "Enter a positive line and column, such as 12:3." };

  let start = 0;
  for (let row = 1; row < line; row++) {
    const newline = text.indexOf("\n", start);
    if (newline < 0) return { error: "Line is outside the displayed source." };
    start = newline + 1;
  }
  const newline = text.indexOf("\n", start);
  const end = newline === -1 ? text.length : newline - Number(text[newline - 1] === "\r");
  const content = text.slice(start, end);
  if (match !== undefined && (typeof match !== "string" || !match || typeof expectedLine !== "string"))
    return { error: "Selecting a match requires its text and the expected source line." };
  if (expectedLine !== undefined && (expectedLine !== content || (partial && newline === -1)))
    return { error: "The requested line could not be verified in the displayed source." };

  // Columns count Unicode code points. GPUI ranges count UTF-16 code units.
  let offset = 0, remaining = column - 1;
  for (const character of content) {
    if (!remaining) break;
    offset += character.length;
    remaining--;
  }
  if (remaining) return { error: "Column is outside the displayed line." };
  if (match !== undefined && (!content.startsWith(match, offset) || /[\uDC00-\uDFFF]/.test(content.charAt(offset + match.length))))
    return { error: "The requested match no longer appears at this column." };
  return { range: { start: start + offset, end: start + offset + (match?.length ?? 0) } };
}

export function literalMatches(text, query) {
  const ranges = [];
  if (!query) return { ranges, limited: false };
  let offset = 0;
  while ((offset = text.indexOf(query, offset)) !== -1) {
    if (ranges.length === FIND_LIMIT) return { ranges, limited: true };
    const end = offset + query.length;
    ranges.push({ start: offset, end });
    offset = end;
  }
  return { ranges, limited: false };
}
