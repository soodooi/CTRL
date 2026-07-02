// toCsv — RFC4180 serialization for smart-table CSV export (Grist/Bitable parity).
// Round-trips with parseCsv (the inverse); the .md file stays the real truth.

import { describe, it, expect } from 'vitest';
import { toCsv, parseCsv } from './smart-table-csv';

describe('toCsv', () => {
  it('serializes a simple table with a header + rows', () => {
    const csv = toCsv(['Symbol', 'Qty'], [['AAPL', '10'], ['BTC', '0.25']]);
    expect(csv).toBe('Symbol,Qty\nAAPL,10\nBTC,0.25\n');
  });

  it('quotes + escapes fields with comma, quote, or newline', () => {
    const csv = toCsv(['Name', 'Note'], [['Acme, Inc.', 'a "quote"'], ['Multi', 'line\nbreak']]);
    // Only fields with comma/quote/newline are quoted; plain `Multi` stays bare.
    expect(csv).toBe('Name,Note\n"Acme, Inc.","a ""quote"""\nMulti,"line\nbreak"\n');
  });

  it('round-trips through parseCsv (the inverse)', () => {
    const headers = ['a', 'b', 'c'];
    const rows = [
      ['plain', 'has,comma', 'has "quote"'],
      ['', 'trailing ', ' leading'],
    ];
    const back = parseCsv(toCsv(headers, rows));
    expect(back[0]).toEqual(headers);
    expect(back[1]).toEqual(rows[0]);
    expect(back[2]).toEqual(rows[1]);
  });

  it('handles an empty row set (header only)', () => {
    expect(toCsv(['x', 'y'], [])).toBe('x,y\n');
  });
});
