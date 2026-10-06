export function parseDelimitedText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && character === "\t") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += character;
  }
  row.push(cell);
  if (row.some(Boolean) || rows.length === 0) rows.push(row);
  return rows;
}

export function serializeDelimitedText(rows: string[][]): string {
  return rows
    .map((row) => row.map(escapeDelimitedCell).join("\t"))
    .join("\r\n");
}

function escapeDelimitedCell(value: string): string {
  if (!/[\t\r\n"]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

export function parseClipboardColumn(
  plainText: string,
  htmlText = "",
): string[] | null {
  const htmlRows = parseHtmlTable(htmlText);
  const rows = htmlRows ?? parseDelimitedText(plainText);
  if (!rows.length || rows.some((row) => row.length !== 1)) return null;
  return rows.map(([cell]) => cell.replace(/\r\n?/g, "\n"));
}

function parseHtmlTable(htmlText: string): string[][] | null {
  if (!/<table[\s>]/i.test(htmlText)) return null;
  const tableMatch = htmlText.match(/<table\b[^>]*>([\s\S]*?)<\/table>/i);
  if (!tableMatch) return null;

  const rows: string[][] = [];
  for (const rowMatch of tableMatch[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells: string[] = [];
    for (const cellMatch of rowMatch[1].matchAll(
      /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi,
    )) {
      cells.push(htmlCellText(cellMatch[1]));
    }
    if (cells.length) rows.push(cells);
  }
  return rows.length ? rows : null;
}

function htmlCellText(html: string): string {
  const withLineBreaks = html
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<(?:div|p|li)\b[^>]*>/gi, "\n")
    .replace(/<\/(?:div|p|li)>\s*/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeHtmlEntities(withLineBreaks)
    .replace(/\r\n?/g, "\n")
    .replace(/^\n+|\n+$/g, "");
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: "\u00a0",
    quot: '"',
  };
  return value.replace(
    /&(#\d+|#x[\da-f]+|amp|apos|gt|lt|nbsp|quot);/gi,
    (match, entity: string) => {
      if (entity[0] !== "#") return named[entity.toLowerCase()] ?? match;
      const hexadecimal = entity[1]?.toLowerCase() === "x";
      const codePoint = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        && !(codePoint >= 0xd800 && codePoint <= 0xdfff)
        ? String.fromCodePoint(codePoint) : match;
    },
  );
}
