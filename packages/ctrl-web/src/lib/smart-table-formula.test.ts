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
});
