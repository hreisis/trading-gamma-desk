import { unzipSync } from "fflate";

const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function readSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  const siRegex = /<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g;
  let match: RegExpExecArray | null;
  while ((match = siRegex.exec(xml)) !== null) {
    const chunk = match[1] ?? "";
    const parts = [...chunk.matchAll(/<(?:\w+:)?t[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)];
    strings.push(
      decodeXmlEntities(parts.map((part) => part[1] ?? "").join("")),
    );
  }
  return strings;
}

function columnLettersToIndex(col: string): number {
  let index = 0;
  for (const ch of col) {
    index = index * 26 + (ch.charCodeAt(0) - 64);
  }
  return index - 1;
}

function parseCellValue(
  cellXml: string,
  sharedStrings: string[],
): string {
  const typeMatch = cellXml.match(/\bt="([^"]+)"/);
  const type = typeMatch?.[1];
  const valueMatch = cellXml.match(/<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/);
  const raw = valueMatch?.[1] ?? "";
  if (type === "s") {
    const idx = Number.parseInt(raw, 10);
    return sharedStrings[idx] ?? "";
  }
  return decodeXmlEntities(raw);
}

/** Read first worksheet of an XLSX buffer into a sparse row matrix. */
export function readXlsxSheet1Matrix(buffer: Buffer): string[][] {
  const zip = unzipSync(new Uint8Array(buffer));
  const sharedEntry = Object.keys(zip).find((name) =>
    name.endsWith("sharedStrings.xml"),
  );
  const sheetEntry = Object.keys(zip).find(
    (name) => name.endsWith("sheet1.xml") || name.endsWith("sheet1.xml".toUpperCase()),
  );
  if (!sheetEntry) {
    throw new Error("xlsx: sheet1.xml not found");
  }
  const sharedStrings = sharedEntry
    ? readSharedStrings(
        Buffer.from(zip[sharedEntry]!).toString("utf8"),
      )
    : [];
  const sheetXml = Buffer.from(zip[sheetEntry]!).toString("utf8");
  const rows: string[][] = [];
  const rowRegex = /<(?:\w+:)?row\b[^>]*>([\s\S]*?)<\/(?:\w+:)?row>/g;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRegex.exec(sheetXml)) !== null) {
    const rowXml = rowMatch[1] ?? "";
    const cells: Array<{ col: number; value: string }> = [];
    const cellRegex = /<(?:\w+:)?c\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?c>/g;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRegex.exec(rowXml)) !== null) {
      const attrs = cellMatch[1] ?? "";
      const ref = attrs.match(/\br="([A-Z]+)(\d+)"/);
      if (!ref) continue;
      const col = columnLettersToIndex(ref[1] ?? "A");
      const value = parseCellValue(cellMatch[0] ?? "", sharedStrings);
      cells.push({ col, value });
    }
    if (cells.length === 0) continue;
    const maxCol = Math.max(...cells.map((cell) => cell.col));
    const row = Array.from({ length: maxCol + 1 }, () => "");
    for (const cell of cells) row[cell.col] = cell.value;
    rows.push(row);
  }
  return rows;
}
