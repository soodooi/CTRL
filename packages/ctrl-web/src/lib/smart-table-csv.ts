// Pure CSV codec for smart tables — no kernel/alias deps, so it unit-tests
// directly (vitest here uses relative imports, no `@` alias). `parseCsv` +
// `toCsv` are inverses (RFC4180-ish: quoted fields, doubled quotes, \r\n).

/** Minimal RFC4180-ish CSV parser: handles quoted fields, escaped quotes, and
 *  \r\n. Drops fully blank rows. */
export const parseCsv = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(cur);
      cur = '';
    } else if (c === '\n') {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
    } else if (c !== '\r') {
      cur += c;
    }
  }
  if (cur !== '' || row.length > 0) {
    row.push(cur);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
};

/** Serialize a header row + data rows to an RFC4180 CSV string: quote a field
 *  that contains a comma / quote / newline, escaping embedded quotes by doubling
 *  (the inverse of `parseCsv`). */
export const toCsv = (headers: string[], rows: string[][]): string => {
  const esc = (s: string): string =>
    /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  const line = (cells: string[]): string => cells.map(esc).join(',');
  return `${[line(headers), ...rows.map(line)].join('\n')}\n`;
};
