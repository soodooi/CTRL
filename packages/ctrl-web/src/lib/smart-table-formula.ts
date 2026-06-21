// smart-table-formula — formula fields (Feishu/Teable: `{field}` references +
// functions). A self-contained, SAFE expression evaluator (no eval / no
// Function constructor / no ANTLR dependency): tokenizer → recursive-descent
// parser → tree-walking evaluator. Values are the row's cell strings; numeric
// ops coerce. The display is derived (not stored), like link/lookup/rollup.
//
// Grammar (precedence low→high):
//   expr    = or
//   or      = and ('||'|'OR' and)*
//   and     = cmp ('&&'|'AND' cmp)*
//   cmp     = add (('='|'=='|'!='|'<>'|'>'|'<'|'>='|'<=') add)*
//   add     = mul (('+'|'-'|'&') mul)*        // '&' = string concat (Excel)
//   mul     = unary (('*'|'/'|'%') unary)*
//   unary   = ('-'|'!'|'NOT') unary | primary
//   primary = number | string | field | name '(' args? ')' | '(' expr ')'

type Val = number | string | boolean;

const isAlpha = (c: string): boolean => /[A-Za-z_]/.test(c);
const isDigit = (c: string): boolean => /[0-9]/.test(c);

interface Token {
  t: 'num' | 'str' | 'field' | 'name' | 'op' | 'lparen' | 'rparen' | 'comma';
  v: string;
}

const tokenize = (src: string): Token[] => {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i] as string;
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i += 1;
      continue;
    }
    if (c === '{') {
      const end = src.indexOf('}', i);
      if (end < 0) throw new Error('unterminated {field}');
      out.push({ t: 'field', v: src.slice(i + 1, end).trim() });
      i = end + 1;
      continue;
    }
    if (c === '"' || c === "'") {
      let s = '';
      i += 1;
      while (i < src.length && src[i] !== c) {
        s += src[i];
        i += 1;
      }
      i += 1;
      out.push({ t: 'str', v: s });
      continue;
    }
    if (isDigit(c) || (c === '.' && isDigit(src[i + 1] ?? ''))) {
      let n = '';
      while (i < src.length && /[0-9.]/.test(src[i] as string)) {
        n += src[i];
        i += 1;
      }
      out.push({ t: 'num', v: n });
      continue;
    }
    if (isAlpha(c)) {
      let id = '';
      while (i < src.length && /[A-Za-z0-9_]/.test(src[i] as string)) {
        id += src[i];
        i += 1;
      }
      out.push({ t: 'name', v: id });
      continue;
    }
    // multi-char operators
    const two = src.slice(i, i + 2);
    if (['==', '!=', '<>', '>=', '<=', '&&', '||'].includes(two)) {
      out.push({ t: 'op', v: two });
      i += 2;
      continue;
    }
    if (c === '(') {
      out.push({ t: 'lparen', v: c });
      i += 1;
      continue;
    }
    if (c === ')') {
      out.push({ t: 'rparen', v: c });
      i += 1;
      continue;
    }
    if (c === ',') {
      out.push({ t: 'comma', v: c });
      i += 1;
      continue;
    }
    if ('+-*/%<>=&!'.includes(c)) {
      out.push({ t: 'op', v: c });
      i += 1;
      continue;
    }
    throw new Error(`unexpected char '${c}'`);
  }
  return out;
};

type Node =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'field'; v: string }
  | { k: 'unary'; op: string; x: Node }
  | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'call'; name: string; args: Node[] };

// Recursive-descent parser.
const parse = (tokens: Token[]): Node => {
  let p = 0;
  const peek = (): Token | undefined => tokens[p];
  const eat = (): Token => tokens[p++] as Token;
  const expect = (t: Token['t']): Token => {
    const tok = eat();
    if (!tok || tok.t !== t) throw new Error(`expected ${t}`);
    return tok;
  };

  const isOp = (...ops: string[]): boolean => {
    const tok = peek();
    return Boolean(tok && (tok.t === 'op' || tok.t === 'name') && ops.includes(tok.v.toUpperCase()));
  };

  const binLevel = (next: () => Node, ...ops: string[]): Node => {
    let node = next();
    while (isOp(...ops)) {
      const op = eat().v.toUpperCase();
      node = { k: 'bin', op, a: node, b: next() };
    }
    return node;
  };

  const primary = (): Node => {
    const tok = peek();
    if (!tok) throw new Error('unexpected end');
    if (tok.t === 'num') return { k: 'num', v: Number(eat().v) };
    if (tok.t === 'str') return { k: 'str', v: eat().v };
    if (tok.t === 'field') return { k: 'field', v: eat().v };
    if (tok.t === 'lparen') {
      eat();
      const e = expr();
      expect('rparen');
      return e;
    }
    if (tok.t === 'name') {
      const name = eat().v;
      if (peek()?.t === 'lparen') {
        eat();
        const args: Node[] = [];
        if (peek()?.t !== 'rparen') {
          args.push(expr());
          while (peek()?.t === 'comma') {
            eat();
            args.push(expr());
          }
        }
        expect('rparen');
        return { k: 'call', name: name.toUpperCase(), args };
      }
      // bare name (TRUE/FALSE/PI) modelled as 0-arg call
      return { k: 'call', name: name.toUpperCase(), args: [] };
    }
    throw new Error(`unexpected token ${tok.v}`);
  };
  const unary = (): Node => {
    if (isOp('-', '!', 'NOT')) {
      const op = eat().v.toUpperCase();
      return { k: 'unary', op, x: unary() };
    }
    return primary();
  };
  const mul = (): Node => binLevel(unary, '*', '/', '%');
  const add = (): Node => binLevel(mul, '+', '-', '&');
  const cmp = (): Node => binLevel(add, '=', '==', '!=', '<>', '>', '<', '>=', '<=');
  const and = (): Node => binLevel(cmp, '&&', 'AND');
  const or = (): Node => binLevel(and, '||', 'OR');
  const expr = (): Node => or();

  const tree = expr();
  if (p < tokens.length) throw new Error('trailing tokens');
  return tree;
};

const num = (v: Val): number => (typeof v === 'number' ? v : Number(v) || 0);
const str = (v: Val): string => (typeof v === 'string' ? v : typeof v === 'boolean' ? (v ? 'true' : '') : String(v));
const truthy = (v: Val): boolean =>
  typeof v === 'boolean' ? v : typeof v === 'number' ? v !== 0 : v !== '' && v !== 'false';

const FNS: Record<string, (args: Val[]) => Val> = {
  SUM: (a) => a.reduce<number>((s, x) => s + num(x), 0),
  AVG: (a) => (a.length ? a.reduce<number>((s, x) => s + num(x), 0) / a.length : 0),
  AVERAGE: (a) => (a.length ? a.reduce<number>((s, x) => s + num(x), 0) / a.length : 0),
  MIN: (a) => (a.length ? Math.min(...a.map(num)) : 0),
  MAX: (a) => (a.length ? Math.max(...a.map(num)) : 0),
  COUNT: (a) => a.filter((x) => str(x) !== '').length,
  ROUND: (a) => {
    const m = 10 ** num(a[1] ?? 0);
    return Math.round(num(a[0] ?? 0) * m) / m;
  },
  CEILING: (a) => Math.ceil(num(a[0] ?? 0)),
  FLOOR: (a) => Math.floor(num(a[0] ?? 0)),
  ABS: (a) => Math.abs(num(a[0] ?? 0)),
  MOD: (a) => num(a[0] ?? 0) % num(a[1] ?? 1),
  POWER: (a) => num(a[0] ?? 0) ** num(a[1] ?? 0),
  IF: (a) => (truthy(a[0] ?? false) ? (a[1] ?? '') : (a[2] ?? '')),
  AND: (a) => a.every(truthy),
  OR: (a) => a.some(truthy),
  NOT: (a) => !truthy(a[0] ?? false),
  CONCATENATE: (a) => a.map(str).join(''),
  CONCAT: (a) => a.map(str).join(''),
  LEN: (a) => str(a[0] ?? '').length,
  UPPER: (a) => str(a[0] ?? '').toUpperCase(),
  LOWER: (a) => str(a[0] ?? '').toLowerCase(),
  TRIM: (a) => str(a[0] ?? '').trim(),
  LEFT: (a) => str(a[0] ?? '').slice(0, num(a[1] ?? 1)),
  RIGHT: (a) => str(a[0] ?? '').slice(-num(a[1] ?? 1)),
  TRUE: () => true,
  FALSE: () => false,
  PI: () => Math.PI,
  BLANK: () => '',
};

const evalNode = (n: Node, row: Record<string, string>): Val => {
  switch (n.k) {
    case 'num':
      return n.v;
    case 'str':
      return n.v;
    case 'field': {
      const raw = row[n.v] ?? '';
      const asNum = Number(raw);
      return raw !== '' && !Number.isNaN(asNum) ? asNum : raw;
    }
    case 'unary': {
      const x = evalNode(n.x, row);
      return n.op === '-' ? -num(x) : !truthy(x);
    }
    case 'bin': {
      const a = evalNode(n.a, row);
      const b = evalNode(n.b, row);
      switch (n.op) {
        case '+':
          return num(a) + num(b);
        case '-':
          return num(a) - num(b);
        case '*':
          return num(a) * num(b);
        case '/':
          return num(b) === 0 ? 0 : num(a) / num(b);
        case '%':
          return num(a) % num(b);
        case '&':
          return str(a) + str(b);
        case '=':
        case '==':
          return typeof a === 'number' || typeof b === 'number' ? num(a) === num(b) : str(a) === str(b);
        case '!=':
        case '<>':
          return str(a) !== str(b) && num(a) !== num(b);
        case '>':
          return num(a) > num(b);
        case '<':
          return num(a) < num(b);
        case '>=':
          return num(a) >= num(b);
        case '<=':
          return num(a) <= num(b);
        case 'AND':
        case '&&':
          return truthy(a) && truthy(b);
        case 'OR':
        case '||':
          return truthy(a) || truthy(b);
        default:
          return '';
      }
    }
    case 'call': {
      const fn = FNS[n.name];
      if (!fn) throw new Error(`unknown function ${n.name}`);
      return fn(n.args.map((arg) => evalNode(arg, row)));
    }
    default:
      return '';
  }
};

/** Evaluate a formula against a row; returns the display string ('#ERR' on a
 *  bad formula). Pure + safe (no eval). */
export const evalFormula = (expression: string, row: Record<string, string>): string => {
  if (!expression.trim()) return '';
  try {
    const v = evalNode(parse(tokenize(expression)), row);
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6);
    return v;
  } catch {
    return '#ERR';
  }
};
