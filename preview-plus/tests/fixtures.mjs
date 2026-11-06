import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";

function crc32(data) {
  let crc = -1;
  for (const byte of data) { crc ^= byte; for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ -1) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type), size = Buffer.alloc(4), crc = Buffer.alloc(4);
  size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([size, name, data, crc]);
}
export function png(width = 640, height = 400, alternate = false) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const pixels = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * (width * 3 + 1) + 1 + x * 3, mountain = y > height * (0.6 + 0.15 * Math.sin(x / width * 8));
    pixels[i] = mountain ? 43 : alternate ? 220 : 126;
    pixels[i + 1] = mountain ? 74 : 170 + Math.round(y / height * 40);
    pixels[i + 2] = mountain ? 70 : 205;
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}

export function pdf(pages = 2) {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", pages === 1 ? "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" : "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 780] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>", "",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 780 600] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  for (const [index, heading] of [[3, "Preview Plus / Page One"], [5, "Preview Plus / Page Two"]]) {
    const stream = `0.95 0.96 0.98 rg 0 0 780 780 re f\n0.12 0.16 0.22 rg BT /F1 28 Tf 48 520 Td (${heading}) Tj ET\n0.25 0.55 0.65 rg 48 100 140 250 re f\n0.35 0.68 0.65 rg 220 100 140 180 re f\n0.55 0.70 0.5 rg 392 100 140 310 re f\n`;
    objects[index] = `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`;
  }
  let result = "%PDF-1.4\n", offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(result)); result += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(result);
  result += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.slice(1).map(offset => String(offset).padStart(10, "0") + " 00000 n \n").join("");
  return result + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}

export async function fixtures(dir) {
  await fs.mkdir(path.join(dir, "notes"), { recursive: true });
  await fs.writeFile(path.join(dir, "landscape.png"), png());
  await fs.writeFile(path.join(dir, "diagram.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="240" viewBox="0 0 640 240"><rect width="640" height="240" fill="#222222"/><rect x="40" y="65" width="150" height="110" rx="8" fill="#70b8ff"/><path d="M210 120h220" stroke="#b4b4b4" stroke-width="4"/><rect x="450" y="65" width="150" height="110" rx="8" fill="#3dd68c"/></svg>');
  await fs.writeFile(path.join(dir, "guide.pdf"), pdf());
  await fs.writeFile(path.join(dir, "notes/next.markdown"), "# Linked note\n\nBack returns to the previous document.\n\n[View the PDF](../guide.pdf)\n");
  await fs.writeFile(path.join(dir, "source.txt"), "A read-only text file.\n");
  await fs.writeFile(path.join(dir, "community.md"), '# Preview Plus\n\n[Details](#details) | [Second details](#details-1) | [Other document](notes/anchors.md#中文-标题)\n\n## Details\n\n```mermaid\nflowchart LR\nRead --> Preview --> Save\n```\n\n## Details\n\n```mermaid\nsequenceDiagram\nEditor->>Disk: Save snapshot\nDisk-->>Editor: Saved\n```\n\n## Unsupported diagram\n\n```mermaid\npie\n"A": 1\n```\n\n````markdown\n# Not a heading\n```mermaid\ngraph LR\nA-->B\n```\n````\n');
  await fs.writeFile(path.join(dir, "notes/anchors.md"), "# Linked document\n\n## 中文 标题\n\n[Return](../community.md#details-1)\n");
  await fs.writeFile(path.join(dir, "data.json"), JSON.stringify({ name: "Preview Plus", items: [{ id: 1, active: true }, { id: 2, active: false }], "a/b": { "~": null } }, null, 2));
  await fs.writeFile(path.join(dir, "table.csv"), 'name,note,count\r\nAda,"Quoted, comma",2\r\nLin,"Two\nlines",3\r\n' + Array.from({ length: 500 }, (_, i) => `Row ${i},Value ${i},${i}\r\n`).join(""));
  await fs.writeFile(path.join(dir, "table.tsv"), "name\tvalue\tnote\nA\t1\tFirst\nB\t2\tSecond\n");
  await fs.writeFile(path.join(dir, "README.md"), "# Preview Plus\n\nOne place for Markdown, images, and PDF pages.\n\n## Explore the files\n\n- [Follow a linked note](notes/next.markdown)\n- [Open the landscape](landscape.png)\n- [View the diagram](diagram.svg)\n- [Read the two-page PDF](guide.pdf)\n- [Read plain text](source.txt)\n- [Herdr documentation](https://herdr.dev)\n\n![Landscape](landscape.png)\n\n```js\nconst preview = { local: true, editable: false };\n```\n");
}
