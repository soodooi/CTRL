import { describe, expect, it } from 'vitest';
import { evalFormula } from './smart-table-formula';

const row = { price: '12', qty: '3', name: 'Acme', score: '4.6', flag: 'true' };

describe('evalFormula', () => {
  it('arithmetic with field refs + precedence', () => {
    expect(evalFormula('{price} * {qty}', row)).toBe('36');
    expect(evalFormula('{price} + {qty} * 2', row)).toBe('18');
    expect(evalFormula('({price} + {qty}) * 2', row)).toBe('30');
  });
  it('functions: ROUND / SUM / MIN / MAX', () => {
    expect(evalFormula('ROUND({score}, 0)', row)).toBe('5');
    expect(evalFormula('ROUND({score}, 1)', row)).toBe('4.6');
    expect(evalFormula('SUM({price}, {qty}, 5)', row)).toBe('20');
    expect(evalFormula('MAX({price}, {qty})', row)).toBe('12');
  });
  it('IF + comparison', () => {
    expect(evalFormula('IF({price} > 10, "big", "small")', row)).toBe('big');
    expect(evalFormula('IF({qty} > 10, "big", "small")', row)).toBe('small');
  });
  it('string concat (& and CONCATENATE)', () => {
    expect(evalFormula('{name} & "-" & {qty}', row)).toBe('Acme-3');
    expect(evalFormula('CONCATENATE({name}, " x", {qty})', row)).toBe('Acme x3');
    expect(evalFormula('UPPER({name})', row)).toBe('ACME');
  });
  it('AND / OR / NOT', () => {
    expect(evalFormula('IF(AND({price} > 5, {qty} > 1), "y", "n")', row)).toBe('y');
    expect(evalFormula('IF(OR({price} > 100, {qty} > 1), "y", "n")', row)).toBe('y');
  });
  it('empty + bad formula', () => {
    expect(evalFormula('', row)).toBe('');
    expect(evalFormula('{price} +', row)).toBe('#ERR');
    expect(evalFormula('NOPE({price})', row)).toBe('#ERR');
  });

  // S2 (plan-univer-formula-augment.md): expanded math/logical/text/date set.
  it('expanded math functions', () => {
    expect(evalFormula('SQRT(16)', row)).toBe('4');
    expect(evalFormula('POWER(2, 10)', row)).toBe('1024');
    expect(evalFormula('ROUNDUP(4.1, 0)', row)).toBe('5');
    expect(evalFormula('ROUNDDOWN(4.9, 0)', row)).toBe('4');
    expect(evalFormula('INT(4.9)', row)).toBe('4');
    expect(evalFormula('SIGN(-3)', row)).toBe('-1');
    expect(evalFormula('PRODUCT({price}, {qty})', row)).toBe('36');
    expect(evalFormula('MEDIAN(1, 3, 2)', row)).toBe('2');
  });
  it('expanded logical: IFS / SWITCH / XOR / ISNUMBER', () => {
    expect(evalFormula('IFS({price} > 100, "a", {price} > 5, "b")', row)).toBe('b');
    expect(evalFormula('SWITCH({qty}, 1, "one", 3, "three", "other")', row)).toBe('three');
    expect(evalFormula('SWITCH({qty}, 1, "one", "other")', row)).toBe('other');
    expect(evalFormula('IF(XOR({price} > 5, {qty} > 100), "y", "n")', row)).toBe('y');
    expect(evalFormula('IF(ISNUMBER({price}), "num", "no")', row)).toBe('num');
    expect(evalFormula('IF(ISNUMBER({name}), "num", "no")', row)).toBe('no');
  });
  it('expanded text: MID / FIND / SUBSTITUTE / PROPER / LEN', () => {
    expect(evalFormula('MID({name}, 2, 2)', row)).toBe('cm');
    expect(evalFormula('FIND("c", {name})', row)).toBe('2');
    expect(evalFormula('SUBSTITUTE({name}, "c", "C")', row)).toBe('ACme');
    expect(evalFormula('PROPER("hello world")', row)).toBe('Hello World');
    expect(evalFormula('LEN({name})', row)).toBe('4');
  });
  it('date functions', () => {
    const d = { start: '2026-01-15', end: '2026-07-03' };
    expect(evalFormula('YEAR({start})', d)).toBe('2026');
    expect(evalFormula('MONTH({start})', d)).toBe('1');
    expect(evalFormula('DAY({start})', d)).toBe('15');
    expect(evalFormula('DATEDIF({start}, {end}, "M")', d)).toBe('6');
    expect(evalFormula('DATE(2026, 7, 3)', d)).toBe('2026-07-03');
  });
});
